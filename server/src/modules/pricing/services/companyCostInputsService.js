// Narrow, explicit cross-module interface — marginPlannerSummary.js (used
// by the CEO Dashboard's cost-summary tile) needs settings/team/expenses to
// compute a company-wide cost rollup, but shouldn't reach into this
// module's repositories directly (see modules/pricing/index.js, exported
// alongside `router`). Same shape db.readCompanySettings()/readTeam()/
// readExpenses() used to return, before those moved into this module.
function createCompanyCostInputsService({ settingsRepository, settingsModel, teamRepository, teamMemberModel, expenseRepository, expenseModel }) {
  function readCompanyCostInputs() {
    return {
      settings: settingsModel.toSettings(settingsRepository.get()),
      team: teamRepository.findAll().map(teamMemberModel.toTeamMember),
      expenses: expenseRepository.findAll().map(expenseModel.toExpense),
    };
  }

  return { readCompanyCostInputs };
}

module.exports = createCompanyCostInputsService;
