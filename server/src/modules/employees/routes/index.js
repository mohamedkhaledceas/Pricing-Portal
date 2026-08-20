const express = require('express');
const catchAsync = require('../../../common/catchAsync');

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

  // submit/managerDecision/pcConfirm/cancel are async (they await the
  // ClickUp sync — see clickupLeaveSync.js) and need catchAsync so an
  // unexpected error reaches errorHandler.js instead of just hanging the
  // request (Express 4 doesn't do this for async handlers on its own).
  router.post('/employees/leave-requests', catchAsync(timeOffController.submit));
  router.get('/employees/leave-requests/mine', timeOffController.listMine);
  router.get('/employees/leave-requests/team', timeOffController.listTeam);
  router.get('/employees/leave-requests/off-today', timeOffController.offToday);
  router.get('/employees/leave-requests/pending', timeOffController.listPcPending);
  router.get('/employees/leave-requests/auto-rejected', timeOffController.listAutoRejected);
  router.patch('/employees/leave-requests/:id/manager-decision', catchAsync(timeOffController.managerDecision));
  router.patch('/employees/leave-requests/:id/pc-confirm', catchAsync(timeOffController.pcConfirm));
  router.post('/employees/leave-requests/:id/cancel', catchAsync(timeOffController.cancel));

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
