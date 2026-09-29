/* Replaces pricing.project_lines' person_id (which pointed at the free-text
   team_members shadow table, no real FK) with a real link to employees —
   see docs/governance/business-portal-tracker.md §4 items 5-8. An employee
   can be on more than one project at once (per user, 2026-09-27); that's
   exactly what a plain many-to-many join table gives for free, one row per
   (project, employee) pair, no schema change needed to support it.

   project_id is ON DELETE CASCADE, matching every sibling project-child
   table's own convention (direct_costs, project_lines, scenarios,
   quote_lines all cascade — confirmed by reading their actual schemas, not
   assumed). A real bug caught this: an earlier version of this migration
   used RESTRICT here, which made deleting any project with an assignment
   fail with a 500 instead of cascading like its siblings. employee_id
   stays RESTRICT — that's the correct, deliberate asymmetry: a project's
   own children should disappear with it, but an employee with live
   assignments should never be silently deletable.

   hours plays the same role project_lines.hours already does (booked hours
   on this specific project — capacity.js's bookings() sums these across a
   person's projects to see over/under-allocation), not the person's
   overall monthly capacity, which is default_hours/default_utilization_pct
   on employees (migration 029) instead.

   Deliberately no effective_from/effective_to — project_lines never
   tracked assignment-period history either, and nothing today needs it;
   adding it now would be exactly the premature complexity this project
   avoids. No unique constraint on (project_id, employee_id) either,
   matching project_lines' own current permissiveness (multiple line
   entries per person per project are already allowed there). */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
      hours REAL NOT NULL DEFAULT 0,
      role_on_project TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_project_assignments_project ON project_assignments(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_assignments_employee ON project_assignments(employee_id);
  `);
}

module.exports = { up };
