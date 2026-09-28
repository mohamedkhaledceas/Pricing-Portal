/* Renames the 'manager' role to 'ceo' — this org has only ever had one
   'manager'-role account, and it has always meant the CEO (see comments in
   modules/employees/models/employee.model.js, modules/employees/views/js/
   main.js, modules/management/ceo-dashboard/routes/index.js — all
   predating this migration). The old name was a real, tracked source of
   confusion: a genuine reporting-line manager and "the CEO's auth role"
   were both called "manager" in different parts of the codebase, which is
   exactly why the Team KPI Summary bug existed (gated to 'manager'/'admin'
   but returning company-wide data regardless of actor). This migration
   only touches the auth role string — manager_employee_id (the reporting-
   line FK) is a separate, unrelated concept and is untouched here.

   SQLite can't ALTER a CHECK constraint in place, so this rebuilds the
   table the same way 001_role_user_to_employee.js and
   004_add_people_culture_role.js already did: foreign_keys off outside the
   transaction, CREATE/copy/DROP/RENAME inside it, foreign_keys back on.
   Existing role='manager' rows become 'ceo'; every other role passes
   through unchanged. Safe to run against a fresh database too. */
function up(db) {
  db.pragma('foreign_keys = OFF');
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_ceo_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'ceo', 'operations', 'finance', 'admin', 'people_culture')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT,
        uuid TEXT
      );
    `);

    const insert = db.prepare(`
      INSERT INTO users_ceo_migrated (id, email, first_name, last_name, password_hash, role, is_active, created_at, updated_at, last_seen_at, uuid)
      VALUES (@id, @email, @first_name, @last_name, @password_hash, @role, @is_active, @created_at, @updated_at, @last_seen_at, @uuid)
    `);
    db.prepare('SELECT * FROM users').all().forEach((row) => {
      insert.run({ ...row, role: row.role === 'manager' ? 'ceo' : row.role });
    });

    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_ceo_migrated RENAME TO users');
    db.exec('CREATE UNIQUE INDEX idx_users_uuid ON users(uuid);');
  });
  migrate();
  db.pragma('foreign_keys = ON');
}

module.exports = { up };
