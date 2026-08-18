/* Read-facing aggregation for the dashboard. Extracted unchanged from the
   old commercialLead.js — same shapes, same behavior, now sourced through
   repositories instead of inline db.prepare calls. */
const { LISTS, INSIGHTS_LIST_ID } = require('../constants');
const dealRepository = require('../repositories/dealRepository');
const dailyCountsRepository = require('../repositories/dailyCountsRepository');
const stageRepository = require('../repositories/stageRepository');
const statusColorRepository = require('../repositories/statusColorRepository');
const { toDeal } = require('../models/deal.model');
const quarterMetricsService = require('./quarterMetricsService');

function getDeals() {
  const result = {};
  for (const [key, listId] of Object.entries(LISTS)) {
    result[key] = dealRepository.findAllByListId(listId).map(toDeal);
  }
  return result;
}

/* Shaped as { status: [{date, value, count}], source: [...], ... } — one
   array per dimension, each entry one (date, value, count) point, so the
   frontend can plot a trend or just read the latest date for a snapshot. */
function getDailyStats(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = dailyCountsRepository.findSince({ listId: INSIGHTS_LIST_ID, sinceDate: since });

  const byDimension = {};
  for (const row of rows) {
    byDimension[row.dimension] = byDimension[row.dimension] || [];
    byDimension[row.dimension].push({ date: row.date, value: row.value, count: row.count });
  }
  return byDimension;
}

/* { pipeline: {status: color}, activeClients: {status: color} } — keyed by
   the same friendly LISTS keys the frontend already uses elsewhere, status
   names lowercased so the frontend lookup doesn't have to case-match
   ClickUp's exact casing. */
function getStatusColors() {
  const result = {};
  for (const [key, listId] of Object.entries(LISTS)) {
    result[key] = {};
    for (const row of statusColorRepository.findByListId(listId)) {
      result[key][row.status.toLowerCase()] = row.color;
    }
  }
  return result;
}

function getStageDurations() {
  const round1 = (n) => Math.round(n * 10) / 10;
  return stageRepository.getDurationsSummary(INSIGHTS_LIST_ID).map((r) => ({
    status: r.status,
    transitions: r.transitions,
    avgDays: round1(r.avgDays),
    minDays: round1(r.minDays),
    maxDays: round1(r.maxDays),
  }));
}

/* Live, cohort-performance quarterly KPI row (docs/adr/0010-commercial-lead-quarterly-kpis.md)
   — always computed fresh from commercial_lead_bucket_events. Never reads
   commercial_lead_quarter_snapshots (the frozen table) for the metrics
   themselves — a quarter viewed here always reflects everything known as
   of right now, even if it's a quarter that already closed. Falls back to
   the current quarter if the requested one has no cohort data at all (an
   invalid/mistyped quarter, or one with zero deals), rather than returning
   an empty/misleading result. */
function getQuarterlyKpis(requestedQuarter) {
  const currentQuarter = quarterMetricsService.getCurrentQuarter();
  const availableQuarters = quarterMetricsService.getQuartersWithData(LISTS.pipeline);
  const quarter = requestedQuarter && availableQuarters.includes(requestedQuarter) ? requestedQuarter : currentQuarter;

  const metrics = quarterMetricsService.computeQuarterMetrics({ listId: LISTS.pipeline, quarter, asOf: null });
  const snapshot = quarterMetricsService.getQuarterSnapshot(LISTS.pipeline, quarter);

  return {
    quarter,
    isCurrent: quarter === currentQuarter,
    isEstimated: quarterMetricsService.hasBackfilledData({ listId: LISTS.pipeline, quarter }),
    availableQuarters,
    metrics,
    snapshot,
  };
}

module.exports = { getDeals, getDailyStats, getStageDurations, getStatusColors, getQuarterlyKpis };
