/* Adds 'commercial' and 'account_management' to the role CHECK constraint —
   the two new roles the CEAS Business Portal work needs (see
   docs/governance/business-portal-tracker.md §1/§4), grounded in real
   ClickUp deal data: 'Sales Person' and 'Account Manager' are already two
   separate, differently-populated custom fields, not one concept doing
   double duty. Purely additive — no existing role value changes, unlike
   024's rename, so there's no data to translate, just a wider CHECK.

   SQLite still can't ALTER a CHECK constraint in place, so this is the same
   table-rebuild pattern as 001/004/024. Safe to run against a fresh
   database too. */
function up(db) {
  db.pragma('foreign_keys = OFF');
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_roles_expanded (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'ceo', 'operations', 'finance', 'admin', 'people_culture', 'commercial', 'account_management')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT,
        uuid TEXT
      );
    `);

    const insert = db.prepare(`
      INSERT INTO users_roles_expanded (id, email, first_name, last_name, password_hash, role, is_active, created_at, updated_at, last_seen_at, uuid)
      VALUES (@id, @email, @first_name, @last_name, @password_hash, @role, @is_active, @created_at, @updated_at, @last_seen_at, @uuid)
    `);
    db.prepare('SELECT * FROM users').all().forEach((row) => insert.run(row));

    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_roles_expanded RENAME TO users');
    db.exec('CREATE UNIQUE INDEX idx_users_uuid ON users(uuid);');
  });
  migrate();
  db.pragma('foreign_keys = ON');
}

module.exports = { up };
