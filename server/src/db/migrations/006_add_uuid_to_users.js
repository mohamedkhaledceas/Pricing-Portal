const crypto = require('crypto');

/* Permanent per-account identifier, distinct from correlationId (which is
   per-request and only ever appears on one request's log lines). This one
   never changes for a given account and is never shown to the account
   holder — admin-only, surfaced in the Users view, so that "an employee
   reports a bug" can be traced end-to-end (logins, audited actions, and
   errors) by grepping one UUID across the log files, without the numeric
   user id being meaningful outside the DB. Backfilled here for existing
   rows; new rows get one at insert time (userRepository.insert,
   create-user.js, seed-owner.js). */
function up(db) {
  db.exec('ALTER TABLE users ADD COLUMN uuid TEXT;');

  const rows = db.prepare('SELECT id FROM users').all();
  const setUuid = db.prepare('UPDATE users SET uuid = ? WHERE id = ?');
  const backfill = db.transaction(() => {
    rows.forEach((row) => setUuid.run(crypto.randomUUID(), row.id));
  });
  backfill();

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);');
}

module.exports = { up };
