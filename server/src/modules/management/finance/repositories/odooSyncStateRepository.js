/* odoo_sync_state — one row per synced Odoo model (migration 032). */
const db = require('../../../../db');
const { toSyncState } = require('../models/odooRecord.model');

function findByModel(model) {
  const row = db.prepare('SELECT * FROM odoo_sync_state WHERE model = ?').get(model);
  return row ? toSyncState(row) : null;
}

function listAll() {
  return db.prepare('SELECT * FROM odoo_sync_state ORDER BY model').all().map(toSyncState);
}

function recordSuccess(model, { lastWriteDate, recordsSynced, runAt }) {
  db.prepare(`
    INSERT INTO odoo_sync_state (model, last_write_date, last_run_at, last_success_at, last_status, last_error, records_synced)
    VALUES (@model, @lastWriteDate, @runAt, @runAt, 'ok', NULL, @recordsSynced)
    ON CONFLICT(model) DO UPDATE SET
      last_write_date = COALESCE(excluded.last_write_date, odoo_sync_state.last_write_date),
      last_run_at = excluded.last_run_at,
      last_success_at = excluded.last_success_at,
      last_status = 'ok',
      last_error = NULL,
      records_synced = excluded.records_synced
  `).run({ model, lastWriteDate, recordsSynced, runAt });
}

/* A change check found nothing new for this copy: it is still current, so
   it counts as a good run (the Control Room's staleness check reads
   last_success_at) without touching records_synced. */
function recordChecked(model, runAt) {
  db.prepare(`
    UPDATE odoo_sync_state SET last_run_at = @runAt, last_success_at = @runAt
    WHERE model = @model AND last_status = 'ok'
  `).run({ model, runAt });
}

function recordFailure(model, { error, runAt }) {
  db.prepare(`
    INSERT INTO odoo_sync_state (model, last_run_at, last_status, last_error)
    VALUES (@model, @runAt, 'error', @error)
    ON CONFLICT(model) DO UPDATE SET
      last_run_at = excluded.last_run_at,
      last_status = 'error',
      last_error = excluded.last_error
  `).run({ model, error, runAt });
}

module.exports = { findByModel, listAll, recordSuccess, recordChecked, recordFailure };
