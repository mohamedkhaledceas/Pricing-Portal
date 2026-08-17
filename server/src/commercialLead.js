const db = require('./db');
const { INSIGHTS_LIST_ID } = require('./clickupSync');
const {
  computeQuarterMetrics,
  getCurrentQuarter,
  getQuartersWithData,
  hasBackfilledData,
  getQuarterSnapshot,
} = require('./commercialLeadQuarterMetrics');

/* Friendly keys for the frontend — real ClickUp list IDs stay an
   implementation detail on this side. */
const LISTS = {
  pipeline: '901518274897', // 2026 Projects — the only one with computed insights
  activeClients: '901522751511', // Active Clients — AM — live display only
  offboarding: '901524651435', // Client Offboarding list — synced, no dedicated UI yet
};

function parseCacheRow(row) {
  return {
    id: row.deal_id,
    name: row.name,
    status: row.status,
    fields: JSON.parse(row.fields_json || '{}'),
    subtasks: JSON.parse(row.subtasks_json || '[]'),
    // ClickUp's own dates — when the deal was actually created/edited there,
    // not when our sync last touched the row (see clickup_created_at comment
    // in db.js for why that distinction matters).
    clickupCreatedAt: row.clickup_created_at,
    clickupUpdatedAt: row.clickup_updated_at,
  };
}

function getDeals() {
  const result = {};
  for (const [key, listId] of Object.entries(LISTS)) {
    const rows = db.prepare('SELECT * FROM commercial_lead_live_cache WHERE list_id = ? ORDER BY updated_at DESC').all(listId);
    result[key] = rows.map(parseCacheRow);
  }
  return result;
}

/* Shaped as { status: [{date, value, count}], source: [...], ... } — one
   array per dimension, each entry one (date, value, count) point, so the
   frontend can plot a trend or just read the latest date for a snapshot. */
function getDailyStats(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT date, dimension, value, count FROM commercial_lead_daily_counts
    WHERE list_id = ? AND date >= ?
    ORDER BY date ASC
  `).all(INSIGHTS_LIST_ID, since);

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
    const rows = db.prepare('SELECT status, color FROM commercial_lead_status_colors WHERE list_id = ?').all(listId);
    result[key] = {};
    for (const row of rows) result[key][row.status.toLowerCase()] = row.color;
  }
  return result;
}

const PIPELINE_FUNNEL_STAGES = ['leads', 'in progress', 'in queue ', 'onboarding', 'qualified', 'contract completed', 'complete'];

/* Extends the pipeline-status snapshot with two cross-list stages computed
   from ClickUp's own Task Relationships ("Related") links — bidirectional,
   never written by us, only mirrored via clickupSync (linked_tasks_json).
   Coverage is partial today (not every downstream task has been linked
   yet) and self-improves as more get linked in ClickUp; linkedCoverage
   exposes that so the UI can be honest about it instead of implying a
   complete count. */
function getFunnel() {
  const latestDateRow = db.prepare(
    "SELECT MAX(date) as date FROM commercial_lead_daily_counts WHERE list_id = ? AND dimension = 'status'"
  ).get(LISTS.pipeline);

  const statusCounts = {};
  if (latestDateRow && latestDateRow.date) {
    const rows = db.prepare(
      "SELECT value, count FROM commercial_lead_daily_counts WHERE list_id = ? AND dimension = 'status' AND date = ?"
    ).all(LISTS.pipeline, latestDateRow.date);
    for (const row of rows) statusCounts[row.value] = row.count;
  }

  const stages = PIPELINE_FUNNEL_STAGES.map((status) => ({
    label: status.trim(),
    count: statusCounts[status] || 0,
  }));

  const pipelineIds = new Set(
    db.prepare('SELECT deal_id FROM commercial_lead_live_cache WHERE list_id = ?').all(LISTS.pipeline).map((r) => r.deal_id)
  );

  // For a downstream list, how many of its tasks link back to a pipeline
  // deal we still have cached (matchedCount — the funnel stage's count),
  // versus how many of its tasks have ANY link at all (linkedTaskCount —
  // the coverage figure, since a link to something other than a live
  // pipeline deal still shows the habit is being followed).
  const linkedPipelineDealsIn = (listId) => {
    const rows = db.prepare('SELECT linked_tasks_json FROM commercial_lead_live_cache WHERE list_id = ?').all(listId);
    let linkedTaskCount = 0;
    const matchedDealIds = new Set();
    for (const row of rows) {
      const links = JSON.parse(row.linked_tasks_json || '[]');
      if (links.length) linkedTaskCount += 1;
      for (const id of links) {
        if (pipelineIds.has(id)) matchedDealIds.add(id);
      }
    }
    return { matchedCount: matchedDealIds.size, linkedTaskCount, totalTasks: rows.length };
  };

  const activeClient = linkedPipelineDealsIn(LISTS.activeClients);
  const offboarded = linkedPipelineDealsIn(LISTS.offboarding);

  stages.push({ label: 'active client', count: activeClient.matchedCount });
  stages.push({ label: 'offboarded', count: offboarded.matchedCount });

  return {
    stages,
    linkedCoverage: {
      activeClients: { linked: activeClient.linkedTaskCount, total: activeClient.totalTasks },
      offboarding: { linked: offboarded.linkedTaskCount, total: offboarded.totalTasks },
    },
  };
}

function getStageDurations() {
  const rows = db.prepare(`
    SELECT status,
           COUNT(*) as transitions,
           AVG(days_in_stage) as avgDays,
           MIN(days_in_stage) as minDays,
           MAX(days_in_stage) as maxDays
    FROM commercial_lead_stage_history
    WHERE list_id = ?
    GROUP BY status
    ORDER BY avgDays DESC
  `).all(INSIGHTS_LIST_ID);

  const round1 = (n) => Math.round(n * 10) / 10;
  return rows.map((r) => ({
    status: r.status,
    transitions: r.transitions,
    avgDays: round1(r.avgDays),
    minDays: round1(r.minDays),
    maxDays: round1(r.maxDays),
  }));
}

/* Live, cohort-performance quarterly KPI row (docs/adr/0010-commercial-lead-quarterly-kpis.md).
   Always computed fresh from commercial_lead_bucket_events — this function
   never reads commercial_lead_quarter_snapshots (the frozen table Step 5
   adds), by design: a quarter viewed here always reflects everything known
   as of right now, even if it's a quarter that already closed. Falls back
   to the current quarter if the requested one has no cohort data at all
   (an invalid/mistyped quarter, or one with zero deals), rather than
   returning an empty/misleading result. */
function getQuarterlyKpis(requestedQuarter) {
  const currentQuarter = getCurrentQuarter();
  const availableQuarters = getQuartersWithData(LISTS.pipeline);
  const quarter = requestedQuarter && availableQuarters.includes(requestedQuarter) ? requestedQuarter : currentQuarter;

  const metrics = computeQuarterMetrics({ listId: LISTS.pipeline, quarter, asOf: null });
  const snapshot = getQuarterSnapshot(LISTS.pipeline, quarter);

  return {
    quarter,
    isCurrent: quarter === currentQuarter,
    isEstimated: hasBackfilledData({ listId: LISTS.pipeline, quarter }),
    availableQuarters,
    metrics,
    snapshot,
  };
}

module.exports = { LISTS, getDeals, getDailyStats, getStageDurations, getStatusColors, getFunnel, getQuarterlyKpis };
