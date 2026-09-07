/* kpi_employee_targets — per-employee override for the handful of metrics
   whose target genuinely varies per person (Production's D1/D4 — see
   kpiFrameworkSeed.data.js). Settable only by that employee's manager or
   an admin (kpiScoringService.setEmployeeTarget) — deliberately narrower
   than manual score entry, which P&C can also do; target-setting stays a
   manager/admin-only operational decision. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_employee_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      quarter TEXT NOT NULL,
      metric_id TEXT NOT NULL,
      target_value REAL NOT NULL,
      set_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, quarter, metric_id),
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
      FOREIGN KEY(set_by) REFERENCES employees(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_kpi_employee_targets_employee_quarter ON kpi_employee_targets(employee_id, quarter);
  `);
}

module.exports = { up };
