/* Plain ADD COLUMN, same reasoning as 007 — none of these touch an existing
   column's CHECK, so no table rebuild is needed.

   department/work_location deliberately do NOT get a CHECK here — SQLite
   can't add a CHECK to an existing column without a full table rebuild, and
   the fixed-list requirement for those two is enforced in the service layer
   instead (rosterService), the same way `status` already restricts itself
   to 'active'/'remote' beyond what its own CHECK (added in 007) allows. */
function up(db) {
  db.exec(`
    ALTER TABLE employees ADD COLUMN work_schedule TEXT;
    ALTER TABLE employees ADD COLUMN is_team_head INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE employees ADD COLUMN profile_locked INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE employee_profile_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      changes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      reviewed_by_user_id INTEGER REFERENCES users(id),
      decision_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX idx_profile_change_requests_employee ON employee_profile_change_requests(employee_id, status);
  `);
}

module.exports = { up };
