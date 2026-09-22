// Composes the same aggregate shape the legacy readState() returned, for
// the one remaining consumer that needs the whole tree at once
// (GET /api/state — the frontend's initial page-load fetch). Reads straight
// from each repository/model rather than calling the other services, to
// keep this a pure composition with no cross-service coupling.
function createStateService({
  settingsRepository, settingsModel, teamRepository, teamMemberModel,
  expenseRepository, expenseModel, projectRepository, projectLineRepository,
  directCostRepository, scenarioRepository, quoteLineRepository, projectModel,
  appStateRepository,
}) {
  function composeProject(row) {
    return projectModel.toProject(row, {
      lines: projectLineRepository.findByProjectId(row.id),
      directCosts: directCostRepository.findByProjectId(row.id),
      scenarios: scenarioRepository.findByProjectId(row.id),
      quoteLines: quoteLineRepository.findByProjectId(row.id),
    });
  }

  function getFullState() {
    const appState = appStateRepository.get();
    return {
      settings: settingsModel.toSettings(settingsRepository.get()),
      security: { pinHash: appState?.security_pin_hash || null },
      team: teamRepository.findAll().map(teamMemberModel.toTeamMember),
      expenses: expenseRepository.findAll().map(expenseModel.toExpense),
      projects: projectRepository.findAll().map(composeProject),
      ui: {
        currentProject: appState?.current_project || null,
        mode: appState?.mode || 'admin',
      },
    };
  }

  return { getFullState };
}

module.exports = createStateService;
