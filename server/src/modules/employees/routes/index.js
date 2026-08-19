const express = require('express');

/* Mounted at /api in index.js. authenticate (from modules/auth) +
   attachEmployee (this module's own middleware) run on every route here —
   every employees-domain endpoint needs to know both "who is logged in"
   and "which employee record, if any, are they". */
function createEmployeesRouter({ rosterController, timeOffController, conflictPairController, kpiController, authenticate, attachEmployee }) {
  const router = express.Router();
  router.use(authenticate, attachEmployee);

  router.get('/employees/me', rosterController.getMine);
  router.get('/employees/directory', rosterController.directory);
  router.get('/employees/team', rosterController.getDirectReports);
  router.get('/employees', rosterController.list);
  router.post('/employees', rosterController.create);
  router.patch('/employees/:id', rosterController.update);
  router.post('/employees/:id/deactivate', rosterController.deactivate);
  router.post('/employees/:id/reactivate', rosterController.reactivate);

  router.post('/employees/leave-requests', timeOffController.submit);
  router.get('/employees/leave-requests/mine', timeOffController.listMine);
  router.get('/employees/leave-requests/team', timeOffController.listTeam);
  router.get('/employees/leave-requests/off-today', timeOffController.offToday);
  router.get('/employees/leave-requests/pending', timeOffController.listPcPending);
  router.patch('/employees/leave-requests/:id/manager-decision', timeOffController.managerDecision);
  router.patch('/employees/leave-requests/:id/pc-confirm', timeOffController.pcConfirm);
  router.post('/employees/leave-requests/:id/cancel', timeOffController.cancel);

  router.get('/employees/conflict-pairs', conflictPairController.list);
  router.post('/employees/conflict-pairs', conflictPairController.create);
  router.post('/employees/conflict-pairs/:id/deactivate', conflictPairController.deactivate);

  router.get('/employees/kpi/frameworks/:kpiProfile', kpiController.getFramework);
  router.get('/employees/kpi/:employeeId/breakdown', kpiController.getBreakdown);
  router.post('/employees/kpi/:employeeId/manual-entry', kpiController.enterManualScore);
  router.post('/employees/kpi/:employeeId/pillar-a', kpiController.enterPillarA);

  return router;
}

module.exports = createEmployeesRouter;
