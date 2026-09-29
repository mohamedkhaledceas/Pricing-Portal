/* Second half of the Margin Planner real-cost foundation (migration 028 was
   the first: salary/currency). personCalc() (modules/pricing/views/js/
   calc.js) needs a person-level monthly capacity assumption (hours,
   utilization %) to compute a blended cost rate — separate from how many
   hours someone is actually booked on any one project, which
   project_assignments (migration 030) covers instead.

   NOT a revival of migration 021 (which dropped working_hours/
   work_schedule) — those were HR-facing onboarding questions ("what's your
   schedule"), removed as a product decision with no replacement intended.
   default_hours/default_utilization_pct are a narrow, cost-modeling-only
   assumption, gated to the same finance-role audience as salary, not
   exposed anywhere in employee self-service. Different feature.

   Defaults (176 hours, 70%) match team_members' own existing defaults —
   sensible baseline assumptions, unlike salary (which varies per person
   enough that defaulting to 0 would misrepresent "not entered yet").
   override_rate mirrors team_members.override_value exactly: nullable, no
   default, a manual override of the computed rate for someone whose real
   cost doesn't fit the salary/hours/util formula.

   job_title already exists on employees — no need to duplicate
   team_members.role. Plain ALTER TABLE, same reasoning as migration 028
   (no CHECK constraints on these columns, no rebuild needed). */
function up(db) {
  const columns = db.prepare('PRAGMA table_info(employees)').all().map((c) => c.name);
  if (!columns.includes('default_hours')) {
    db.exec('ALTER TABLE employees ADD COLUMN default_hours REAL DEFAULT 176;');
  }
  if (!columns.includes('default_utilization_pct')) {
    db.exec('ALTER TABLE employees ADD COLUMN default_utilization_pct REAL DEFAULT 70;');
  }
  if (!columns.includes('override_rate')) {
    db.exec('ALTER TABLE employees ADD COLUMN override_rate REAL;');
  }
}

module.exports = { up };
