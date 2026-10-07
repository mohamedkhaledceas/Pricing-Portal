/* clickup_client_sync_state — the dropdown sync's single status row
   (migration 034, CHECK id = 1). Only SQL. */
const db = require('../../../../db');

function get() {
  const row = db.prepare('SELECT * FROM clickup_client_sync_state WHERE id = 1').get();
  return row ? {
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastStatus: row.last_status,
    lastTrigger: row.last_trigger,
  } : { lastAttemptAt: null, lastSuccessAt: null, lastStatus: null, lastTrigger: null };
}

function recordResult({ status, trigger, error = null, at }) {
  db.prepare(`
    INSERT INTO clickup_client_sync_state (id, last_attempt_at, last_success_at, last_status, last_error, last_trigger)
    VALUES (1, @at, CASE WHEN @status = 'ok' THEN @at END, @status, @error, @trigger)
    ON CONFLICT(id) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = COALESCE(excluded.last_success_at, clickup_client_sync_state.last_success_at),
      last_status = excluded.last_status,
      last_error = excluded.last_error,
      last_trigger = excluded.last_trigger
  `).run({ status, trigger, error, at });
}

module.exports = { get, recordResult };
