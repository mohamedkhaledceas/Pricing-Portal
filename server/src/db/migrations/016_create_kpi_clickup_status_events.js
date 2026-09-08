/* kpi_clickup_status_events — one row per real ClickUp status transition
   received over the KPI webhook, for every list in the workspace (not
   just currently-mapped ones — see kpi_auto_metric_mappings' comment for
   why). Forward-only from whenever this ships; no historical backfill is
   attempted (ClickUp's webhook stream has no retroactive history to pull).
   `quarter` is a generated column using the same cairoQuarterExpr SQL
   builder db.js's other generated quarter columns already use — kept in
   sync with occurred_at automatically, never written by application code. */
function up(db) {
  const { cairoQuarterExpr } = require('../../utils/cairoQuarter');

  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_clickup_status_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      clickup_list_id TEXT NOT NULL,
      employee_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      quarter TEXT GENERATED ALWAYS AS (${cairoQuarterExpr('occurred_at')}) VIRTUAL,
      webhook_event_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_kpi_status_events_employee_quarter_status ON kpi_clickup_status_events(employee_id, quarter, to_status);
    CREATE INDEX IF NOT EXISTS idx_kpi_status_events_list_quarter ON kpi_clickup_status_events(clickup_list_id, quarter);
  `);
}

module.exports = { up };
