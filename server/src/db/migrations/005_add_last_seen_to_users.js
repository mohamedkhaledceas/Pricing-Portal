/* Backs the "Who's Online" presence widget. No CHECK constraint on this
   column, so it's a plain nullable ADD COLUMN — no table-rebuild dance
   needed (unlike 001/004's role-CHECK migrations). */
function up(db) {
  db.exec('ALTER TABLE users ADD COLUMN last_seen_at TEXT;');
}

module.exports = { up };
