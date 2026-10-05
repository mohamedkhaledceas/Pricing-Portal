/* Read-facing aggregation for the dashboard. Extracted unchanged from the
   old commercialLead.js — same shapes, same behavior, now sourced through
   repositories instead of inline db.prepare calls. */
const { ValidationError } = require('../../../../common/errors');
const { LISTS, INSIGHTS_LIST_ID } = require('../constants');
const dealRepository = require('../repositories/dealRepository');
const dealRecordRepository = require('../repositories/dealRecordRepository');
const dailyCountsRepository = require('../repositories/dailyCountsRepository');
const stageRepository = require('../repositories/stageRepository');
const statusColorRepository = require('../repositories/statusColorRepository');
const { toDeal } = require('../models/deal.model');
const quarterMetricsService = require('./quarterMetricsService');
const { mapStatusToBucket } = require('./bucketService');

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

/* The CEO Control Room's pipeline block (modules/management/ceo-dashboard,
   via this module's container). Counts only — ClickUp has a deal value on
   too few deals (Project Value is set on ~7%) to show money honestly.
   - open: deals in the 2026 Projects list by the funnel bucket their
     current status maps to (bucketService), open buckets only.
   - quarters: the current quarter's cohort row and the latest earlier one
     (a quarter a few days old has an empty cohort), exactly as the
     Commercial Lead page computes them (ADR-0010) — no second definition
     of conversion.
   - stageDurations: average days spent per status, same as that page. */
const OPEN_BUCKETS = [
  { bucket: 'leads', name: 'Leads' },
  { bucket: 'qualified', name: 'Qualified' },
  { bucket: 'onboarding', name: 'Onboarding' },
  { bucket: 'in_progress', name: 'In progress' },
];

function getPipelineSummary() {
  const counts = new Map(OPEN_BUCKETS.map((b) => [b.bucket, 0]));
  for (const row of dealRepository.findAllByListId(LISTS.pipeline)) {
    const bucket = mapStatusToBucket(row.status);
    if (counts.has(bucket)) counts.set(bucket, counts.get(bucket) + 1);
  }
  const current = getQuarterlyKpis(null);
  const previousId = current.availableQuarters.filter((q) => q < current.quarter).sort().pop();
  const quarters = [current, previousId ? getQuarterlyKpis(previousId) : null]
    .filter(Boolean)
    .map((q) => ({ id: q.quarter, isCurrent: q.isCurrent, isEstimated: q.isEstimated, ...q.metrics }));
  return {
    open: OPEN_BUCKETS.map((b) => ({ bucket: b.bucket, name: b.name, count: counts.get(b.bucket) })),
    quarters,
    stageDurations: getStageDurations(),
  };
}

/* The CEO Control Room's client book (via this module's container): every
   deal record tied to a portal client, from any tracked list, with the
   funnel bucket its status maps to (null for statuses outside the funnel,
   e.g. the Active Clients list's own). */
const LIST_NAMES = { pipeline: 'Pipeline', activeClients: 'Active clients', offboarding: 'Offboarding' };
const LIST_KEY_BY_ID = new Map(Object.entries(LISTS).map(([key, id]) => [id, key]));

function toClientDeal(row) {
  const list = LIST_KEY_BY_ID.get(row.list_id) || null;
  return {
    clientId: row.client_id,
    dealId: row.deal_id,
    name: row.name,
    status: row.status.trim(),
    bucket: mapStatusToBucket(row.status),
    list,
    listName: LIST_NAMES[list] || 'Other',
    value: row.value,
    currency: row.currency,
    salesPerson: row.sales_person,
    accountManager: row.account_manager,
    createdAt: row.clickup_created_at,
    updatedAt: row.clickup_updated_at,
  };
}

function getClientDeals() {
  return dealRecordRepository.listWithClient().map(toClientDeal);
}

function getDealsForClient(clientId) {
  return dealRecordRepository.findByClientId(clientId).map(toClientDeal);
}

// Wraps a value in quotes and doubles any embedded quotes whenever it
// contains a comma, quote, or newline — the one thing the older KPI-export
// precedent (kpiScoringService.exportHistoryCsv) skips, safely only because
// its own fields are all plain numbers. Deal names and custom-field values
// are free text and routinely contain commas, so this can't be skipped here.
function csvEscape(value) {
  const str = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function fieldValueText(field) {
  if (!field) return '';
  return Array.isArray(field.value) ? field.value.join('; ') : String(field.value);
}

/* One flat table per list — Name/Status/every custom field seen on any deal
   in that list (the union, so every row has the same columns even though
   ClickUp custom fields are populated per-task)/Created/Last Updated. Reuses
   getDeals()'s same toDeal() shape; no separate query path to keep in sync. */
function exportDealsCsv(listKey) {
  if (!Object.prototype.hasOwnProperty.call(LISTS, listKey)) {
    throw new ValidationError(`"list" must be one of: ${Object.keys(LISTS).join(', ')}.`);
  }
  const deals = getDeals()[listKey];
  const fieldNames = Array.from(new Set(deals.flatMap((d) => Object.keys(d.fields)))).sort();

  const header = ['Name', 'Status', ...fieldNames, 'Created', 'Last Updated'];
  const lines = [header.map(csvEscape).join(',')];
  deals.forEach((d) => {
    const row = [
      d.name,
      d.status,
      ...fieldNames.map((name) => fieldValueText(d.fields[name])),
      d.clickupCreatedAt || '',
      d.clickupUpdatedAt || '',
    ];
    lines.push(row.map(csvEscape).join(','));
  });
  // CRLF — the CSV-standard line ending, and what makes Excel on Windows
  // treat every row as a real row instead of occasionally mis-splitting on
  // a bare \n depending on locale/version.
  return lines.join('\r\n');
}

module.exports = {
  getDeals, getDailyStats, getStageDurations, getStatusColors, getQuarterlyKpis, getPipelineSummary, exportDealsCsv,
  getClientDeals, getDealsForClient,
};
