const express = require('express');
const requireRole = require('../../../../common/middleware/requireRole');
const { ROLES } = require('../../../../common/constants/roles');

/* Mounted at /api in app.js. Every route: authenticate first (401 without
   a valid access token), then a role gate (403 otherwise).
   - GET /api/ceo-dashboard/control-room — requireCeo (ceo, admin).
   - GET /api/ceo-dashboard/budget — requireBudgetViewer (ceo, admin,
     operations, people_culture). Returns only the Budget tab's data;
     operations and people_culture get no other route here.

   Gated to ROLES.CEO and ROLES.ADMIN — narrower than the broader
   USER_MANAGER_ROLES set commercial-leads uses (which also includes
   operations). 'ceo' is this org's single top-level exec role (see
   modules/employees/views/js/main.js's own comment on MANAGE_ROSTER_ROLES);
   admin is included to match that same file's CEO_DASHBOARD_ROLES gate on
   the nav button. Operations does not get a pass here just because it can
   manage users elsewhere. */
function createCeoDashboardRouter({ ceoDashboardController, authenticate }) {
  const router = express.Router();
  const requireCeo = requireRole([ROLES.CEO, ROLES.ADMIN]);
  const requireBudgetViewer = requireRole([ROLES.CEO, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.PEOPLE_CULTURE]);

  router.get('/ceo-dashboard/control-room', authenticate, requireCeo, ceoDashboardController.controlRoom);
  router.get('/ceo-dashboard/budget', authenticate, requireBudgetViewer, ceoDashboardController.budget);

  return router;
}

module.exports = createCeoDashboardRouter;
