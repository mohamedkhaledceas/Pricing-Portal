const express = require('express');
const catchAsync = require('../../../common/catchAsync');
const { upload, verifyImageSignature, scanForMalware } = require('../middleware/photoUpload');

/* Mounted at /api in index.js. authenticate (from modules/auth) +
   attachEmployee (this module's own middleware) run on every route here —
   every employees-domain endpoint needs to know both "who is logged in"
   and "which employee record, if any, are they". */
function createEmployeesRouter({ rosterController, timeOffController, conflictPairController, kpiController, departmentController, authenticate, attachEmployee }) {
  const router = express.Router();

  // Pre-auth: the signup wizard's Assigned Manager dropdown needs this
  // before any account/token exists — see rosterController.teamHeadsPublic
  // and employeeModel.toTeamHeadOption for how narrow the returned shape
  // is (id + name only, nothing else exposed pre-login).
  router.get('/employees/team-heads', rosterController.teamHeadsPublic);

  // Also pre-auth, same reasoning — the signup wizard's own department
  // dropdown needs this before any account/token exists. Department names
  // aren't sensitive; see departmentService.list's own comment.
  router.get('/employees/departments', departmentController.list);

  router.use(authenticate, attachEmployee);

  router.get('/employees/me', rosterController.getMine);
  router.patch('/employees/me', rosterController.updateMine);
  router.post('/employees/me/photo', upload.single('photo'), verifyImageSignature, scanForMalware, rosterController.uploadMyPhoto);
  router.delete('/employees/me/photo', rosterController.removeMyPhoto);
  router.get('/employees/directory', rosterController.directory);
  router.get('/employees/profile-change-requests', rosterController.pendingChangeRequests);
  router.patch('/employees/profile-change-requests/:id/approve', rosterController.approveChangeRequest);
  router.patch('/employees/profile-change-requests/:id/reject', rosterController.rejectChangeRequest);
  router.get('/employees/team', rosterController.getDirectReports);
  router.get('/employees', rosterController.list);
  router.post('/employees', rosterController.create);
  router.patch('/employees/:id', rosterController.update);
  router.post('/employees/:id/deactivate', rosterController.deactivate);
  router.post('/employees/:id/reactivate', rosterController.reactivate);
  router.post(
    '/employees/:id/photo',
    upload.single('photo'),
    verifyImageSignature,
    scanForMalware,
    rosterController.uploadPhoto
  );

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
  router.get('/employees/leave-requests/:employeeId/breakdown', timeOffController.getLeaveBreakdown);
  router.patch('/employees/leave-requests/:id/manager-decision', catchAsync(timeOffController.managerDecision));
  router.patch('/employees/leave-requests/:id/pc-confirm', catchAsync(timeOffController.pcConfirm));
  router.post('/employees/leave-requests/:id/cancel', catchAsync(timeOffController.cancel));

  // Self-scoped, no admin/P&C gate — an employee checking who their own
  // conflict partner is, or whether that partner already overlaps a
  // candidate date range, isn't the management CRUD below.
  router.get('/employees/conflict-pairs/mine', conflictPairController.mine);
  router.get('/employees/conflict-pairs/mine/overlap', conflictPairController.mineOverlap);

  router.get('/employees/conflict-pairs', conflictPairController.list);
  router.post('/employees/conflict-pairs', conflictPairController.create);
  router.patch('/employees/conflict-pairs/:id', conflictPairController.update);
  router.delete('/employees/conflict-pairs/:id', conflictPairController.remove);

  // Create/update are gated server-side to manager/people_culture/
  // operations/admin inside departmentService.requireCanManage — the list
  // route above is the only pre-auth/no-gate one. update renames the
  // label only — code (the FK target) never changes.
  router.post('/employees/departments', departmentController.create);
  router.patch('/employees/departments/:id', departmentController.update);

  router.get('/employees/kpi/frameworks/:kpiProfile', kpiController.getFramework);
  router.get('/employees/kpi/current-quarter', kpiController.getCurrentQuarter);
  router.get('/employees/kpi/available-quarters', kpiController.getAvailableQuarters);
  router.get('/employees/kpi/required-actions', kpiController.getRequiredActions);
  router.get('/employees/kpi/team-summary', kpiController.getTeamSummary);
  router.get('/employees/kpi/notifications', kpiController.listNotifications);
  router.patch('/employees/kpi/notifications/:id/read', kpiController.markNotificationRead);
  router.get('/employees/kpi/:employeeId/breakdown', kpiController.getBreakdown);
  router.get('/employees/kpi/:employeeId/history', kpiController.getHistory);
  router.get('/employees/kpi/:employeeId/history/export', kpiController.exportHistory);
  router.post('/employees/kpi/:employeeId/manual-entry', kpiController.enterManualScore);
  router.get('/employees/kpi/:employeeId/targets', kpiController.getTargets);
  router.post('/employees/kpi/:employeeId/targets', kpiController.setTarget);
  router.get('/employees/kpi/auto-mappings', kpiController.listAutoMetricMappings);
  router.post('/employees/kpi/auto-mappings', kpiController.setAutoMetricMapping);
  router.delete('/employees/kpi/auto-mappings/:kpiProfile/:metricId', kpiController.removeAutoMetricMapping);
  router.get('/employees/kpi/clickup-lists', kpiController.listClickupLists);
  router.post('/employees/kpi/compute-auto-scores', catchAsync(kpiController.runComputeAutoScores));
  router.get('/employees/kpi/peer-review/window', kpiController.getReviewWindow);
  router.post('/employees/kpi/peer-review/window', kpiController.setReviewWindow);
  router.get('/employees/kpi/peer-review/roster', kpiController.getPeerReviewRoster);
  router.get('/employees/kpi/peer-review/completion', kpiController.getPeerReviewCompletion);
  router.get('/employees/kpi/peer-review/counter', kpiController.getPeerReviewCounter);
  router.get('/employees/kpi/peer-review/my-status', kpiController.getMyPeerReviewStatus);
  router.post('/employees/kpi/peer-review/:revieweeId', kpiController.submitPeerReview);
  router.post('/employees/kpi/:employeeId/self-evaluation', kpiController.enterSelfEvaluation);

  return router;
}

module.exports = createEmployeesRouter;
