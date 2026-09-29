// Narrow, explicit cross-module interface — marginPlannerSummary.js (used
// by the CEO Dashboard's cost-summary tile) needs settings/team/expenses to
// compute a company-wide cost rollup, but shouldn't reach into this
// module's repositories directly (see modules/pricing/index.js, exported
// alongside `router`). Same shape db.readCompanySettings()/readTeam()/
// readExpenses() used to return, before those moved into this module.
//
// `team` sources from modules/employees' listEmployeesForPlanner now, not
// team_members (migrations 028-030, tracker §4 item 8) — team_members is
// no longer written to once the Team & Salaries tab's backend moved to
// real employees, so leaving this on the old table would mean the CEO
// dashboard's cost tile quietly goes stale. includeCompensation is always
// true here (not resolved from an actor role) because this function's only
// consumer (the CEO dashboard) is already gated to ceo/admin, both already
// in COMPENSATION_ROLES — there's no "wrong audience" this could leak to.
function createCompanyCostInputsService({ settingsRepository, settingsModel, listEmployeesForPlanner, expenseRepository, expenseModel }) {
  function readCompanyCostInputs() {
    return {
      settings: settingsModel.toSettings(settingsRepository.get()),
      team: listEmployeesForPlanner({ includeCompensation: true }),
      expenses: expenseRepository.findAll().map(expenseModel.toExpense),
    };
  }

  return { readCompanyCostInputs };
}

module.exports = createCompanyCostInputsService;
