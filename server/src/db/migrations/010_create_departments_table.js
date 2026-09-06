/* Replaces the hardcoded DEPARTMENTS array (server/src/modules/employees/
   constants.js) with a real table that manager/people_culture/operations/
   admin can add rows to at runtime — see docs/adr/0011. Seeded with the
   current 9 fixed values so no existing employee's department dropdown
   selection regresses.

   `active` is soft-delete, same convention as conflict_pairs.active — a
   deactivated department disappears from "select for a new assignment"
   dropdowns but keeps rendering its real label for anyone still on it. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(active);
  `);

  const insert = db.prepare('INSERT OR IGNORE INTO departments (code, label) VALUES (?, ?)');
  [
    ['account_managers', 'Account Managers'],
    ['content', 'Content'],
    ['designers', 'Designers'],
    ['operations', 'Operations'],
    ['public_relations', 'Public Relations'],
    ['performance', 'Performance'],
    ['production', 'Production'],
    ['sales_business_development', 'Sales & Business Development'],
    ['social_media_specialists', 'Social Media Specialists'],
  ].forEach(([code, label]) => insert.run(code, label));
}

module.exports = { up };
