/* Replaces employees.is_people_culture (a boolean flag orthogonal to auth
   role) with a genuine 'people_culture' entry in users.role. SQLite can't
   ALTER a CHECK constraint in place, so the users table gets the same
   rebuild treatment 001_role_user_to_employee.js already used; dropping
   employees.is_people_culture is a plain DROP COLUMN since it carries no
   CHECK constraint (and the bundled better-sqlite3 build is SQLite 3.49,
   well past 3.35's native DROP COLUMN support).

   Data preservation: any employee row with is_people_culture = 1 has its
   linked user's role promoted to 'people_culture' UNLESS that user is
   already 'admin' (admin already implies full access; don't downgrade it).
   Since role is now a single value rather than a second orthogonal flag,
   a user who previously held e.g. 'manager' AND the P&C flag ends up with
   only 'people_culture' after this migration — an inherent, confirmed
   consequence of the flag-to-role change, not an oversight. */
function up(db) {
  const flaggedUserIds = db.prepare(`
    SELECT u.id FROM users u
    JOIN employees e ON e.user_id = u.id
    WHERE e.is_people_culture = 1 AND u.role != 'admin'
  `).all().map((row) => row.id);

  db.pragma('foreign_keys = OFF');
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_pc_role_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'manager', 'operations', 'finance', 'admin', 'people_culture')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const insert = db.prepare(`
      INSERT INTO users_pc_role_migrated (id, email, first_name, last_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (@id, @email, @first_name, @last_name, @password_hash, @role, @is_active, @created_at, @updated_at)
    `);
    const flaggedSet = new Set(flaggedUserIds);
    db.prepare('SELECT * FROM users').all().forEach((row) => {
      insert.run({ ...row, role: flaggedSet.has(row.id) ? 'people_culture' : row.role });
    });

    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_pc_role_migrated RENAME TO users');

    db.exec('ALTER TABLE employees DROP COLUMN is_people_culture');
  });
  migrate();
  db.pragma('foreign_keys = ON');
}

module.exports = { up };
