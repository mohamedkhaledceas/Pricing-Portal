/* kpi_auto_metric_mappings — data-driven config saying *how* one Pillar B
   metric is computed from ClickUp, per role, using that role's own real
   list(s)/status name(s)/tag(s). Never assumes any metric's real-world
   shape matches KPI_Framework.xlsx's wording or another role's lists —
   see docs/adr/0012 addendum for why (status vocabulary differs list to
   list in the real workspace). A metric with no active row here simply
   stays manual/semi, same as before this table existed. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_auto_metric_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kpi_profile TEXT NOT NULL,
      metric_id TEXT NOT NULL,
      method TEXT NOT NULL CHECK (method IN ('status_entry_count', 'time_in_status_avg', 'tagged_task_count', 'due_date_on_time_rate')),
      config_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(kpi_profile, metric_id),
      FOREIGN KEY(created_by) REFERENCES employees(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_kpi_auto_metric_mappings_active ON kpi_auto_metric_mappings(active);
  `);
}

module.exports = { up };
