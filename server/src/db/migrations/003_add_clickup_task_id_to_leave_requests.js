/* Tracks the ClickUp task created for a leave request on submission, so the
   manager-decision and P&C-confirm steps know which task to PATCH the
   Leave Status field on (see services/clickupLeaveSync.js). Nullable and
   a plain ADD COLUMN — no CHECK constraint involved, so this doesn't need
   the table-rebuild dance 001 used. */
function up(db) {
  db.exec(`ALTER TABLE leave_requests ADD COLUMN clickup_task_id TEXT;`);
}

module.exports = { up };
