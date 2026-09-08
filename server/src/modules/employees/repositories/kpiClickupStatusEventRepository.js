/* kpi_clickup_status_events — only SQL here. */
const db = require('../../../db');

function insert({ taskId, clickupListId, employeeId, fromStatus, toStatus, occurredAt, webhookEventId }) {
  try {
    const info = db.prepare(`
      INSERT INTO kpi_clickup_status_events (task_id, clickup_list_id, employee_id, from_status, to_status, occurred_at, webhook_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, clickupListId, employeeId, fromStatus || null, toStatus, occurredAt, webhookEventId);
    return { inserted: true, id: info.lastInsertRowid };
  } catch (error) {
    // UNIQUE(webhook_event_id) — a redelivered event, not an error.
    // ClickUp documents at-least-once delivery, so this is expected to
    // happen occasionally, not exceptional.
    if (/UNIQUE constraint failed/.test(error.message)) {
      return { inserted: false, reason: 'duplicate' };
    }
    throw error;
  }
}

// Count of events landing on `toStatus`, for one employee, in one quarter,
// restricted to the given lists — the primitive behind
// kpiClickupMetricsService.countStatusEntries.
function countByEmployeeStatusQuarter({ employeeId, listIds, toStatus, quarter }) {
  if (!listIds || listIds.length === 0) return 0;
  const placeholders = listIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT COUNT(*) AS n FROM kpi_clickup_status_events
    WHERE employee_id = ? AND to_status = ? AND quarter = ? AND clickup_list_id IN (${placeholders})
  `).get(employeeId, toStatus, quarter, ...listIds).n;
}

module.exports = { insert, countByEmployeeStatusQuarter };
