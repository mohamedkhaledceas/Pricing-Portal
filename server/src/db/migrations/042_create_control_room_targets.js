/* Control Room targets and hand-entered KPIs — phase 3.2. Owned by
   modules/management/ceo-dashboard.

   Targets are kept per view — entity 'ceas', 'fze', 'lwm' or 'all' —
   because each view's figures are in its own currency (an EGP target means
   nothing against FZE's AED). They start empty (user decision 2026-10-06:
   none of the prototype's invented targets are seeded). Clearing a target
   sets it to NULL rather than deleting the row; every change is audited
   (control_room.kpi_target.update).

   control_room_custom_kpis: KPIs added on the Targets page, each belonging
   to the view it was added in, with a hand-entered actual. Removing one
   archives it (archived = 1) — never deleted. kpi_key is what the page
   uses as the KPI id ('custom_<id>').

   ceo/admin only — enforced in the service. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS control_room_kpi_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL CHECK (entity IN ('ceas', 'fze', 'lwm', 'all')),
      kpi_id TEXT NOT NULL,
      target NUMERIC,
      updated_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL,
      UNIQUE (entity, kpi_id)
    );

    CREATE TABLE IF NOT EXISTS control_room_custom_kpis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL CHECK (entity IN ('ceas', 'fze', 'lwm', 'all')),
      name TEXT NOT NULL,
      unit TEXT NOT NULL CHECK (unit IN ('egp', 'pct', 'days', 'count', 'ratio', 'months')),
      direction TEXT NOT NULL CHECK (direction IN ('higher_better', 'lower_better')),
      target_type TEXT NOT NULL CHECK (target_type IN ('min', 'max', 'exact')),
      component TEXT NOT NULL,
      actual NUMERIC,
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_control_room_custom_kpis_entity ON control_room_custom_kpis(entity, archived);
  `);
}

module.exports = { up };
