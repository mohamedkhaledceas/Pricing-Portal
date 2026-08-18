/* Renames the generic default role from 'user' to 'employee' — SQLite can't
   ALTER a CHECK constraint in place, so this rebuilds the table the exact
   same way db.js's existing pre-email/roles users rebuild already does:
   PRAGMA foreign_keys off outside the transaction (better-sqlite3 refuses
   to toggle it inside one), the actual CREATE/copy/DROP/RENAME sequence
   inside a transaction so a failure can't leave the schema half-migrated,
   then foreign_keys back on. Existing rows with role='user' become
   'employee'; every other role passes through unchanged. Safe to run
   against a fresh database too (no 'user' rows to translate, just rebuilds
   an already-correct table) — the migration runner only runs this once
   either way, tracked in schema_migrations. */
function up(db) {
  db.pragma('foreign_keys = OFF');
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_role_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'manager', 'operations', 'finance', 'admin')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const insert = db.prepare(`
      INSERT INTO users_role_migrated (id, email, first_name, last_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (@id, @email, @first_name, @last_name, @password_hash, @role, @is_active, @created_at, @updated_at)
    `);
    db.prepare('SELECT * FROM users').all().forEach((row) => {
      insert.run({ ...row, role: row.role === 'user' ? 'employee' : row.role });
    });

    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_role_migrated RENAME TO users');
  });
  migrate();
  db.pragma('foreign_keys = ON');
}

module.exports = { up };
