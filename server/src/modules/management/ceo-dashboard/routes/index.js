const express = require('express');
const requireRole = require('../../../../common/middleware/requireRole');
const { ROLES } = require('../../../../common/constants/roles');

/* Mounted at /api in app.js. Every route: authenticate first (401 without
   a valid access token), then a role gate (403 otherwise).
   - GET /api/ceo-dashboard/control-room — requireCeo (ceo, admin).
   - GET /api/ceo-dashboard/budget — requireBudgetViewer (ceo, admin,
     operations, people_culture). Returns only the Budget tab's data.
   - GET /api/ceo-dashboard/clients — requireClientBookViewer (ceo, admin,
     operations; user decision 2026-10-06). The cross-company client
     book (query: search, company, type, link, overdue, sort, currency,
     dir, page, pageSize; 400 on anything outside the allowed values).
   - GET /api/ceo-dashboard/clients/:key — requireClientBookViewer. One client's Odoo
     record, deals and live ClickUp tasks (key client:<id> | partner:<id>;
     400 malformed, 404 unknown).
   - PUT /api/ceo-dashboard/budget/lines/:name — requireCeo. Saves one P&L
     line's annual budget (body: annual, note).
   - PUT /api/ceo-dashboard/budget/plan — requireBudgetViewer, then the
     service checks the function is the caller's own (ceo/admin: all;
     people_culture: people + hiring; operations: ops) — 403 otherwise.
     Body: functionId, category, month (0–11), amount, note.
   - PUT /api/ceo-dashboard/targets — requireCeo. One KPI's target for one
     view (body: entity ceas|fze|lwm|all, kpiId, target number|null, note).
   - POST /api/ceo-dashboard/kpis — requireCeo. Adds a hand-entered KPI to
     a view; POST /api/ceo-dashboard/kpis/:kpiId/archive — requireCeo,
     removes it (archived, never deleted).
   - PUT /api/ceo-dashboard/escalation/routes/:area — requireCeo (body:
     comesToCeo true|false); PUT /api/ceo-dashboard/escalation/threshold —
     requireCeo (body: amount). Company-wide, not per view.

   /control-room is gated to ROLES.CEO and ROLES.ADMIN — narrower than the broader
   USER_MANAGER_ROLES set commercial-leads uses (which also includes
   operations). 'ceo' is this org's single top-level exec role (see
   modules/employees/views/js/main.js's own comment on MANAGE_ROSTER_ROLES);
   admin is included to match that same file's CEO_DASHBOARD_ROLES gate on
   the nav button. Operations does not get a pass here just because it can
   manage users elsewhere; it gets the client book and the Budget tab,
   nothing else here. people_culture gets the Budget tab only. */
function createCeoDashboardRouter({ ceoDashboardController, authenticate }) {
  const router = express.Router();
  const requireCeo = requireRole([ROLES.CEO, ROLES.ADMIN]);
  const requireBudgetViewer = requireRole([ROLES.CEO, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.PEOPLE_CULTURE]);
  const requireClientBookViewer = requireRole([ROLES.CEO, ROLES.ADMIN, ROLES.OPERATIONS]);

  router.get('/ceo-dashboard/control-room', authenticate, requireCeo, ceoDashboardController.controlRoom);
  router.get('/ceo-dashboard/budget', authenticate, requireBudgetViewer, ceoDashboardController.budget);
  router.put('/ceo-dashboard/budget/lines/:name', authenticate, requireCeo, ceoDashboardController.updateBudgetLine);
  router.put('/ceo-dashboard/budget/plan', authenticate, requireBudgetViewer, ceoDashboardController.updateFunctionPlan);
  router.put('/ceo-dashboard/targets', authenticate, requireCeo, ceoDashboardController.updateTarget);
  router.post('/ceo-dashboard/kpis', authenticate, requireCeo, ceoDashboardController.addKpi);
  router.post('/ceo-dashboard/kpis/:kpiId/archive', authenticate, requireCeo, ceoDashboardController.archiveKpi);
  router.put('/ceo-dashboard/escalation/routes/:area', authenticate, requireCeo, ceoDashboardController.updateEscalationRoute);
  router.put('/ceo-dashboard/escalation/threshold', authenticate, requireCeo, ceoDashboardController.updateEscalationThreshold);
  router.get('/ceo-dashboard/clients', authenticate, requireClientBookViewer, ceoDashboardController.clients);
  router.get('/ceo-dashboard/clients/:key', authenticate, requireClientBookViewer, ceoDashboardController.clientDetail);

  return router;
}

module.exports = createCeoDashboardRouter;
