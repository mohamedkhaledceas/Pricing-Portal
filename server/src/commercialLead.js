const db = require('./db');
const { INSIGHTS_LIST_ID } = require('./clickupSync');

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

module.exports = { LISTS, getDeals, getDailyStats, getStageDurations };
