/* finance_data_checks — the result of each self-check run after a full
   Odoo sync (startup and nightly). Owned by modules/management/finance.
   One row per check, overwritten each run; a failing row is shown on the
   Control Room so a wrong figure is never trusted silently. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_data_checks (
      check_key TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('ok', 'fail', 'error')),
      detail TEXT,
      checked_at TEXT NOT NULL
    );
  `);
}

module.exports = { up };
