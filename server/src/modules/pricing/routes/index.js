const express = require('express');

/* Mounted at /api in index.js. authenticate (from modules/auth) +
   requirePlannerAccess (common/middleware/requireRole, the same
   USER_MANAGER_ROLES gate the legacy Planner routes used) run on every
   route here — Planner access is uniformly role-gated today (no
   self-vs-elevated split like employees has), so one router-level gate
   covers it, same shape as employees' own router.use(authenticate,
   attachEmployee). */
function createPricingRouter({ settingsController, teamController, expenseController, projectController, stateController, authenticate, requirePlannerAccess }) {
  const router = express.Router();

  router.use(authenticate, requirePlannerAccess);

  router.get('/settings', settingsController.get);
  router.put('/settings', settingsController.update);

  router.get('/team', teamController.list);
  router.post('/team', teamController.create);
  router.put('/team/:id', teamController.update);
  router.delete('/team/:id', teamController.remove);

  router.get('/expenses', expenseController.list);
  router.post('/expenses', expenseController.create);
  router.put('/expenses/:id', expenseController.update);
  router.delete('/expenses/:id', expenseController.remove);

  router.get('/projects', projectController.list);
  router.post('/projects', projectController.create);
  router.put('/projects/:id', projectController.update);
  router.delete('/projects/:id', projectController.remove);
  router.get('/projects/:id/history', projectController.history);

  router.post('/projects/:projectId/lines', projectController.createLine);
  router.put('/projects/:projectId/lines/:id', projectController.updateLine);
  router.delete('/projects/:projectId/lines/:id', projectController.removeLine);

  router.post('/projects/:projectId/direct-costs', projectController.createDirectCost);
  router.put('/projects/:projectId/direct-costs/:id', projectController.updateDirectCost);
  router.delete('/projects/:projectId/direct-costs/:id', projectController.removeDirectCost);

  router.post('/projects/:projectId/scenarios', projectController.createScenario);
  router.put('/projects/:projectId/scenarios/:id', projectController.updateScenario);
  router.delete('/projects/:projectId/scenarios/:id', projectController.removeScenario);

  router.post('/projects/:projectId/quote-lines', projectController.createQuoteLine);
  router.put('/projects/:projectId/quote-lines/:id', projectController.updateQuoteLine);
  router.delete('/projects/:projectId/quote-lines/:id', projectController.removeQuoteLine);

  router.get('/state', stateController.get);
  router.put('/state', stateController.disabled);

  return router;
}

module.exports = createPricingRouter;
