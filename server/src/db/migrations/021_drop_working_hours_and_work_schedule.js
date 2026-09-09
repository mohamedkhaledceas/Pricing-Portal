/* Drops employees.working_hours and employees.work_schedule — both fields
   (and their signup/roster/account-settings questions) were removed as a
   product decision; there's no replacement. SQLite can't DROP COLUMN in
   this version, so this rebuilds `employees` the same way migration 011
   rebuilt it for the department FK — see that file for the identical
   PRAGMA/transaction shape this mirrors. */
function up(db) {
  db.pragma('foreign_keys = OFF');
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE employees_drop_hours_schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        clickup_user_id TEXT,
        department TEXT REFERENCES departments(code) ON DELETE RESTRICT,
        kpi_profile TEXT CHECK (kpi_profile IN ('content','artdirector','aidesigner','production','am','pandc','heads','design')),
        manager_employee_id INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        job_title TEXT,
        employment_type TEXT CHECK (employment_type IN ('full_time','part_time','freelancer')),
        joining_date TEXT,
        work_location TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','remote')),
        photo_url TEXT,
        is_team_head INTEGER NOT NULL DEFAULT 0,
        profile_locked INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY(manager_employee_id) REFERENCES employees(id) ON DELETE RESTRICT
      );
    `);

    db.exec(`
      INSERT INTO employees_drop_hours_schedule (
        id, user_id, clickup_user_id, department, kpi_profile, manager_employee_id, active,
        created_at, updated_at, job_title, employment_type, joining_date, work_location,
        status, photo_url, is_team_head, profile_locked
      )
      SELECT
        id, user_id, clickup_user_id, department, kpi_profile, manager_employee_id, active,
        created_at, updated_at, job_title, employment_type, joining_date, work_location,
        status, photo_url, is_team_head, profile_locked
      FROM employees;
    `);

    db.exec('DROP TABLE employees');
    db.exec('ALTER TABLE employees_drop_hours_schedule RENAME TO employees');

    db.exec('CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_employee_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department)');
  });
  migrate();
  db.pragma('foreign_keys = ON');
}

module.exports = { up };
