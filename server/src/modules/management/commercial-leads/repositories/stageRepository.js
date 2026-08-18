/* commercial_lead_stage_tracking (working state) + commercial_lead_stage_history
   (permanent, append-only). Extracted unchanged from clickupSync.js/commercialLead.js. */
const db = require('../../../../db');

function findTracking(dealId) {
  return db.prepare('SELECT * FROM commercial_lead_stage_tracking WHERE deal_id = ?').get(dealId);
}

function insertHistory({ dealId, listId, status, enteredAt, exitedAt, daysInStage }) {
  db.prepare(`
    INSERT INTO commercial_lead_stage_history (deal_id, list_id, status, entered_at, exited_at, days_in_stage)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(dealId, listId, status, enteredAt, exitedAt, daysInStage);
}

function upsertTracking({ dealId, listId, status, enteredAt }) {
  db.prepare(`
    INSERT INTO commercial_lead_stage_tracking (deal_id, list_id, current_status, entered_status_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(deal_id) DO UPDATE SET
      list_id = excluded.list_id,
      current_status = excluded.current_status,
      entered_status_at = excluded.entered_status_at
  `).run(dealId, listId, status, enteredAt);
}

function getDurationsSummary(listId) {
  return db.prepare(`
    SELECT status,
           COUNT(*) as transitions,
           AVG(days_in_stage) as avgDays,
           MIN(days_in_stage) as minDays,
           MAX(days_in_stage) as maxDays
    FROM commercial_lead_stage_history
    WHERE list_id = ?
    GROUP BY status
    ORDER BY avgDays DESC
  `).all(listId);
}

module.exports = { findTracking, insertHistory, upsertTracking, getDurationsSummary };
