// Composes the same aggregate shape the legacy readState() returned, for
// the one remaining consumer that needs the whole tree at once
// (GET /api/state — the frontend's initial page-load fetch). Reads straight
// from each repository/model rather than calling the other services, to
// keep this a pure composition with no cross-service coupling.
//
// `team` sources from modules/employees' listEmployeesForPlanner, same as
// teamService (migrations 028-030, tracker §4 item 8) — this endpoint is
// the frontend's actual initial-load fetch, so leaving it on the old
// team_members table would mean page load shows stale/wrong data (nothing
// writes team_members anymore) and, worse, would still leak raw salary to
// any requirePlannerAccess-scoped viewer regardless of the /team fix.
// actorRole is required now, not optional — there's no safe default for
// "should this response include compensation."
function createStateService({
  settingsRepository, settingsModel, listEmployeesForPlanner, canViewCompensation,
  expenseRepository, expenseModel, projectRepository, projectAssignmentRepository,
  directCostRepository, scenarioRepository, quoteLineRepository, projectModel,
  appStateRepository,
}) {
  function composeProject(row) {
    return projectModel.toProject(row, {
      lines: projectAssignmentRepository.findByProjectId(row.id),
      directCosts: directCostRepository.findByProjectId(row.id),
      scenarios: scenarioRepository.findByProjectId(row.id),
      quoteLines: quoteLineRepository.findByProjectId(row.id),
    });
  }

  function getFullState({ actorRole }) {
    const appState = appStateRepository.get();
    return {
      settings: settingsModel.toSettings(settingsRepository.get()),
      security: { pinHash: appState?.security_pin_hash || null },
      team: listEmployeesForPlanner({ includeCompensation: canViewCompensation(actorRole) }),
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
