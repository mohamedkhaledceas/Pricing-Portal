/* Foundation for the Margin Planner real-cost work (see
   docs/governance/business-portal-tracker.md §4 items 5-6) — real employee
   compensation replacing the free-text team_members shadow table.

   salary is nullable, no default: most of the 74 existing employees have
   no compensation data yet, and defaulting to 0 would misrepresent "not
   entered yet" as "earns nothing." currency defaults to 'EGP', matching
   the same default already used by team_members/projects/expenses
   elsewhere in this app — harmless even before salary is set, and this
   is a single-currency (EGP-based) operation in practice.

   Deliberately NOT adding cost_per_hour as a stored column — see this
   migration's own commit context: cost-per-hour is derived from salary
   (+ the per-assignment hours/utilization on project_assignments, the next
   migration in this sequence) at query time, the same way the Margin
   Planner's existing personCalc() already derives it for team_members.
   Storing both risks the two drifting apart — the exact failure mode
   migration 021 (dropped working_hours/work_schedule) already exists
   because of.

   Plain ALTER TABLE, not the CHECK-constraint table-rebuild dance
   migrations 024/025 needed — neither new column has a CHECK, so SQLite
   can add them directly. */
function up(db) {
  const columns = db.prepare('PRAGMA table_info(employees)').all().map((c) => c.name);
  if (!columns.includes('salary')) {
    db.exec("ALTER TABLE employees ADD COLUMN salary REAL;");
  }
  if (!columns.includes('currency')) {
    db.exec("ALTER TABLE employees ADD COLUMN currency TEXT DEFAULT 'EGP';");
  }
}

module.exports = { up };
