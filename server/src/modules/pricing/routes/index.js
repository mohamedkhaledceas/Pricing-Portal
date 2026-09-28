const express = require('express');

/* Mounted at /api in index.js. authenticate (from modules/auth) runs on
   every route here; role gating is no longer a single blanket
   requirePlannerAccess like before migration 028-030's Margin Planner
   real-cost work — Team & Salaries now sources from real employees
   (modules/employees' listEmployeesForPlanner/updateEmployeeCompensation,
   see pricing/container.js), and the two audiences aren't the same set.
   requirePlannerAccess (admin/ceo/operations, common/permissions.js's
   USER_MANAGER_ROLES) still gates the general Planner surface (settings/
   expenses/projects/state) exactly as before. /team gets its own two
   gates: requireTeamViewAccess (the general Planner set PLUS
   COMPENSATION_ROLES, so operations can still list people to staff a
   project) and requireTeamEditAccess (COMPENSATION_ROLES only —
   ceo/people_culture/finance/admin — for the actual salary write). Content
   redaction for a viewer in the general-but-not-compensation set (i.e.
   operations) happens inside teamController/teamService, not here — this
   router layer only decides who gets in the door at all. POST/DELETE
   /team are gone entirely: employees are managed in modules/employees, not
   created/deleted from the Planner. */
function createPricingRouter({
  settingsController, teamController, expenseController, projectController, stateController,
  authenticate, requirePlannerAccess, requireTeamViewAccess, requireTeamEditAccess,
}) {
  const router = express.Router();

  router.use(authenticate);

  router.get('/settings', requirePlannerAccess, settingsController.get);
  router.put('/settings', requirePlannerAccess, settingsController.update);

  router.get('/team', requireTeamViewAccess, teamController.list);
  router.put('/team/:id', requireTeamEditAccess, teamController.update);

  router.get('/expenses', requirePlannerAccess, expenseController.list);
  router.post('/expenses', requirePlannerAccess, expenseController.create);
  router.put('/expenses/:id', requirePlannerAccess, expenseController.update);
  router.delete('/expenses/:id', requirePlannerAccess, expenseController.remove);

  router.get('/projects', requirePlannerAccess, projectController.list);
  router.post('/projects', requirePlannerAccess, projectController.create);
  router.put('/projects/:id', requirePlannerAccess, projectController.update);
  router.delete('/projects/:id', requirePlannerAccess, projectController.remove);
  router.get('/projects/:id/history', requirePlannerAccess, projectController.history);

  router.post('/projects/:projectId/lines', requirePlannerAccess, projectController.createLine);
  router.put('/projects/:projectId/lines/:id', requirePlannerAccess, projectController.updateLine);
  router.delete('/projects/:projectId/lines/:id', requirePlannerAccess, projectController.removeLine);

  router.post('/projects/:projectId/direct-costs', requirePlannerAccess, projectController.createDirectCost);
  router.put('/projects/:projectId/direct-costs/:id', requirePlannerAccess, projectController.updateDirectCost);
  router.delete('/projects/:projectId/direct-costs/:id', requirePlannerAccess, projectController.removeDirectCost);

  router.post('/projects/:projectId/scenarios', requirePlannerAccess, projectController.createScenario);
  router.put('/projects/:projectId/scenarios/:id', requirePlannerAccess, projectController.updateScenario);
  router.delete('/projects/:projectId/scenarios/:id', requirePlannerAccess, projectController.removeScenario);

  router.post('/projects/:projectId/quote-lines', requirePlannerAccess, projectController.createQuoteLine);
  router.put('/projects/:projectId/quote-lines/:id', requirePlannerAccess, projectController.updateQuoteLine);
  router.delete('/projects/:projectId/quote-lines/:id', requirePlannerAccess, projectController.removeQuoteLine);

  router.get('/state', requirePlannerAccess, stateController.get);
  router.put('/state', requirePlannerAccess, stateController.disabled);

  return router;
}

module.exports = createPricingRouter;
