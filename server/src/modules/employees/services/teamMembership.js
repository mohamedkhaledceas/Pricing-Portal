/* Pure, unit-testable rule — no DB, no req/res. Single source of truth for
   "who is on this employee's team", shared by every team-scoped screen (My
   Team tab, Team KPI Summary, and any future one) so the rule only ever
   lives in one place.

   Department and the reporting line are two independent relationships — an
   employee's manager need not share their department — so this is
   deliberately not folded into either a manager-FK query or a department
   query alone:

   - No current direct reports -> team is just the rest of the department.
   - At least one current direct report -> team is those direct reports
     unioned with the rest of the department (deduplicated).

   "Manages other employees" is computed purely from the current reporting
   line (employees.manager_employee_id — who currently lists this person as
   their manager), never from a role or the is_team_head flag. Those are
   assignable independently (is_team_head just gates who *can* be picked as
   a manager) and can drift out of sync with who actually reports to whom. */
function resolveTeamMembership({ directReports, departmentMembers }) {
  const isManager = directReports.length > 0;
  if (!isManager) return { isManager, members: departmentMembers };

  const byId = new Map();
  for (const row of directReports) byId.set(row.id, row);
  for (const row of departmentMembers) byId.set(row.id, row);
  return { isManager, members: Array.from(byId.values()) };
}

module.exports = { resolveTeamMembership };
