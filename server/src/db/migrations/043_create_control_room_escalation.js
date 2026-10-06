/* Control Room escalation preferences — phase 3.3. Owned by
   modules/management/ceo-dashboard.

   Company-wide (not per view): which areas' decisions come to the CEO and
   the money threshold above which any decision does. Seeded once with the
   Control Room's defaults (user decision 2026-10-05: seed, don't start
   empty). Changed by ceo/admin only, enforced in the service; audited
   (control_room.escalation.update). Rows are only ever updated.

   - control_room_escalation_routes: one row per area; comes_to_ceo 1 =
     "Comes to me", 0 = "Head owns it".
   - control_room_settings: a single row (CHECK id = 1), same pattern as
     finance_settings — the sign-off threshold in EGP. */
const DEFAULT_ROUTES = {
  cash: 1, collections: 1, revenue: 1, pipeline: 1, strategic: 1, delivery: 0, people: 0, operations: 0,
};
const DEFAULT_THRESHOLD = 150000;

function up(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS control_room_escalation_routes (
        area TEXT PRIMARY KEY,
        comes_to_ceo INTEGER NOT NULL CHECK (comes_to_ceo IN (0, 1)),
        updated_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS control_room_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        sign_off_threshold NUMERIC NOT NULL CHECK (sign_off_threshold >= 0),
        updated_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
        updated_at TEXT NOT NULL
      );
    `);
    const now = new Date().toISOString();
    const insertRoute = db.prepare('INSERT OR IGNORE INTO control_room_escalation_routes (area, comes_to_ceo, updated_at) VALUES (?, ?, ?)');
    for (const [area, toCeo] of Object.entries(DEFAULT_ROUTES)) insertRoute.run(area, toCeo, now);
    db.prepare('INSERT OR IGNORE INTO control_room_settings (id, sign_off_threshold, updated_at) VALUES (1, ?, ?)').run(DEFAULT_THRESHOLD, now);
  })();
}

module.exports = { up };
