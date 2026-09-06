/* Adds a real FK from employees.department -> departments.code, now that
   departments (migration 010) is a real table instead of a frozen array.
   SQLite can't ALTER an existing column to add a FK, so this rebuilds
   `employees` the same way 004_add_people_culture_role.js rebuilt `users`
   for its role CHECK constraint change — see that file for the identical
   PRAGMA/transaction shape this mirrors.

   Any employee row whose department doesn't match a seeded department code
   (the exact free-text/mismatched-case values that motivated this whole
   feature) gets that raw value promoted into its own departments row
   first, verbatim as `code` (so no employee row has to change) with a
   title-cased `label` — so the rebuild below can never fail on existing
   data, and no employee's assignment is silently dropped, blanked, or
   nulled. Empty-string department values are normalized to NULL first
   (parity with "no department set" — some rows already have '' instead of
   NULL from before this column had any validation at all). */
function up(db) {
  db.exec("UPDATE employees SET department = NULL WHERE department = ''");

  const knownCodes = new Set(db.prepare('SELECT code FROM departments').all().map((row) => row.code));
  const orphanedCodes = db
    .prepare('SELECT DISTINCT department FROM employees WHERE department IS NOT NULL')
    .all()
    .map((row) => row.department)
    .filter((code) => !knownCodes.has(code));

  const titleCase = (value) => value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const insertDepartment = db.prepare('INSERT INTO departments (code, label) VALUES (?, ?)');
  orphanedCodes.forEach((code) => insertDepartment.run(code, titleCase(code)));

  db.pragma('foreign_keys = OFF');
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE employees_dept_fk_migrated (
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
        working_hours TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','remote')),
        photo_url TEXT,
        work_schedule TEXT,
        is_team_head INTEGER NOT NULL DEFAULT 0,
        profile_locked INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY(manager_employee_id) REFERENCES employees(id) ON DELETE RESTRICT
      );
    `);

    db.exec(`
      INSERT INTO employees_dept_fk_migrated (
        id, user_id, clickup_user_id, department, kpi_profile, manager_employee_id, active,
        created_at, updated_at, job_title, employment_type, joining_date, work_location,
        working_hours, status, photo_url, work_schedule, is_team_head, profile_locked
      )
      SELECT
        id, user_id, clickup_user_id, department, kpi_profile, manager_employee_id, active,
        created_at, updated_at, job_title, employment_type, joining_date, work_location,
        working_hours, status, photo_url, work_schedule, is_team_head, profile_locked
      FROM employees;
    `);

    db.exec('DROP TABLE employees');
    db.exec('ALTER TABLE employees_dept_fk_migrated RENAME TO employees');

    db.exec('CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_employee_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department)');
  });
  migrate();
  db.pragma('foreign_keys = ON');
}

module.exports = { up };
