/* commercial_lead_live_cache — the mirror of each tracked ClickUp task's
   current state. Only SQL here; JSON/field shaping stays in services and
   models. Extracted unchanged from the old commercialLead.js/clickupSync.js. */
const db = require('../../../../db');
const { cairoQuarterExpr } = require('../../../../utils/cairoQuarter');

function findAllByListId(listId) {
  return db.prepare('SELECT * FROM commercial_lead_live_cache WHERE list_id = ? ORDER BY updated_at DESC').all(listId);
}

function findByDealId(dealId) {
  return db.prepare('SELECT * FROM commercial_lead_live_cache WHERE deal_id = ?').get(dealId);
}

function findListIdByDealId(dealId) {
  const row = db.prepare('SELECT list_id FROM commercial_lead_live_cache WHERE deal_id = ?').get(dealId);
  return row ? row.list_id : null;
}

function listDealIdsByListId(listId) {
  return db.prepare('SELECT deal_id FROM commercial_lead_live_cache WHERE list_id = ?').all(listId).map((r) => r.deal_id);
}

function upsert({ dealId, listId, name, status, fields, subtasks, linkedTasks, clickupCreatedAt, clickupUpdatedAt }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO commercial_lead_live_cache
      (deal_id, list_id, name, status, fields_json, subtasks_json, linked_tasks_json, clickup_created_at, clickup_updated_at, created_at, updated_at)
    VALUES
      (@deal_id, @list_id, @name, @status, @fields_json, @subtasks_json, @linked_tasks_json, @clickup_created_at, @clickup_updated_at, @now, @now)
    ON CONFLICT(deal_id) DO UPDATE SET
      list_id = excluded.list_id,
      name = excluded.name,
      status = excluded.status,
      fields_json = excluded.fields_json,
      subtasks_json = excluded.subtasks_json,
      linked_tasks_json = excluded.linked_tasks_json,
      clickup_created_at = excluded.clickup_created_at,
      clickup_updated_at = excluded.clickup_updated_at,
      updated_at = excluded.updated_at
  `).run({
    deal_id: dealId,
    list_id: listId,
    name,
    status,
    fields_json: JSON.stringify(fields),
    subtasks_json: JSON.stringify(subtasks || []),
    linked_tasks_json: JSON.stringify(linkedTasks || []),
    clickup_created_at: clickupCreatedAt || null,
    clickup_updated_at: clickupUpdatedAt || null,
    now,
  });
}

// cascades to commercial_lead_stage_tracking
function remove(dealId) {
  db.prepare('DELETE FROM commercial_lead_live_cache WHERE deal_id = ?').run(dealId);
}

function countByListAndQuarter(listId, quarter) {
  return db.prepare('SELECT COUNT(*) AS n FROM commercial_lead_live_cache WHERE list_id = ? AND origin_quarter = ?').get(listId, quarter).n;
}

// Lean projection for the client-identity resolver — only what it needs,
// not the full row (subtasks_json etc.) for every deal.
function findFieldsByListId(listId) {
  return db.prepare('SELECT deal_id, fields_json FROM commercial_lead_live_cache WHERE list_id = ?').all(listId);
}

// Every distinct origin_quarter with at least one deal, ascending — the
// full set of quarters that could ever be shown.
function listDistinctQuartersByListId(listId) {
  return db
    .prepare(
      `SELECT DISTINCT origin_quarter FROM commercial_lead_live_cache
       WHERE list_id = ? AND origin_quarter IS NOT NULL
       ORDER BY origin_quarter`
    )
    .all(listId)
    .map((r) => r.origin_quarter);
}

// "What quarter is it right now" — delegates to the same cairoQuarterExpr
// the generated columns use, rather than a separate JS reimplementation.
function getCurrentQuarter() {
  return db.prepare(`SELECT (${cairoQuarterExpr("datetime('now')")}) AS q`).get().q;
}

module.exports = {
  findAllByListId,
  findByDealId,
  findListIdByDealId,
  listDealIdsByListId,
  upsert,
  remove,
  countByListAndQuarter,
  findFieldsByListId,
  listDistinctQuartersByListId,
  getCurrentQuarter,
};
