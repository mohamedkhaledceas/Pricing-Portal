/* employee_kpi_notifications — in-app-only KPI feedback notifications
   (item 14). Deliberately scoped to this module rather than a repo-wide
   notifications framework: nothing else in the app needs one yet, so a
   general mechanism isn't earned (see docs/adr/0012-kpi-evaluation-
   lifecycle.md). user_id references auth.users, not employees — the
   recipient is "who logs in", matching how every other module-boundary
   FK to auth in this codebase is drawn. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_kpi_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('pillar_a_review', 'metric_comment')),
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_employee_kpi_notifications_user ON employee_kpi_notifications(user_id, read_at);
  `);
}

module.exports = { up };
