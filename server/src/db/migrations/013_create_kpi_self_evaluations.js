/* kpi_self_evaluations — an employee's own rating of themselves on the
   same 6 Pillar A dimensions, one row per (employee, quarter). This has no
   equivalent in KPI_Framework.xlsx (Pillar A there is anonymous peer +
   manager review only) — it's shown alongside Pillar A for comparison but
   deliberately never folded into kpi_scoring_service's final.total, so it
   lives in its own table rather than reusing kpi_pillar_a_reviews. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_self_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      quarter TEXT NOT NULL,
      communication REAL,
      collaboration REAL,
      reliability REAL,
      attitude REAL,
      contribution REAL,
      growth REAL,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, quarter),
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_kpi_self_evaluations_employee_quarter ON kpi_self_evaluations(employee_id, quarter);
  `);
}

module.exports = { up };
