const { PricingError } = require('../errors');

/* Team & Salaries tab — sources real employees via modules/employees'
   public interface (listEmployeesForPlanner/updateEmployeeCompensation),
   not the old team_members shadow table (migrations 028-030, tracker §4
   item 8). No create/remove here anymore: employees are managed in
   modules/employees, not created or deleted from the Planner.

   Redaction for a non-compensation-authorized viewer (e.g. operations,
   here for the general Planner surface but not salary) happens by asking
   listEmployeesForPlanner for the non-compensation shape — the HTTP
   response itself never contains salary/currency/default_hours/
   default_utilization_pct/override_rate for that viewer, not just a UI
   that hides them. */
function createTeamService({ listEmployeesForPlanner, updateEmployeeCompensation, canViewCompensation, canEditCompensation }) {
  function list({ actorRole }) {
    return listEmployeesForPlanner({ includeCompensation: canViewCompensation(actorRole) });
  }

  function update({ id, patch, actorRole, actorId, actorEmail, ip }) {
    if (!canEditCompensation(actorRole)) {
      throw new PricingError('You do not have permission to edit compensation.', 403);
    }
    const updated = updateEmployeeCompensation({ employeeId: id, patch, actorId, actorEmail, ip });
    if (!updated) throw new PricingError('Employee not found.', 404);
    return list({ actorRole });
  }

  return { list, update };
}

module.exports = createTeamService;
