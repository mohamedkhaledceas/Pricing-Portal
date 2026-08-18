const fs = require('fs');
const path = require('path');

/* Ordered, tracked migrations — replaces the single-schema-string-plus-ad-
   hoc-PRAGMA-existence-check pattern db.js used for one-off rebuilds
   (still present there for the pre-email/roles users shape and the
   commercial_lead_live_cache column additions; new schema changes from here
   on go through this instead).

   Each file in migrations/ exports an up(db) function and is run at most
   once, tracked by name in schema_migrations, in filename order (hence the
   NNN_ prefix convention). Deliberately does NOT wrap migration.up(db) in a
   transaction here: better-sqlite3 can't toggle `PRAGMA foreign_keys`
   inside a transaction, and a table-rebuild migration (the SQLite-only way
   to change a CHECK constraint) needs to do exactly that — so each
   migration manages its own transactional boundaries internally, the same
   way db.js's existing users-table rebuild already does. If a migration
   throws, its schema_migrations row is never written, so it's safely
   retried on the next boot. */
function runMigrations(db, migrationsDir = path.join(__dirname, 'migrations')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name));

  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.js')).sort()
    : [];

  for (const file of files) {
    if (applied.has(file)) continue;

    // eslint-disable-next-line global-require, import/no-dynamic-require
    const migration = require(path.join(migrationsDir, file));
    if (typeof migration.up !== 'function') {
      throw new Error(`Migration "${file}" does not export an up(db) function.`);
    }

    migration.up(db);
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
  }
}

module.exports = { runMigrations };
