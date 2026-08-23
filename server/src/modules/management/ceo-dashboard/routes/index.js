const express = require('express');
const requireRole = require('../../../../common/middleware/requireRole');
const { ROLES } = require('../../../../common/constants/roles');

/* Mounted at /api in app.js: /api/ceo-dashboard/snapshot, /brief.

   Gated to ROLES.MANAGER and ROLES.ADMIN — narrower than the broader
   USER_MANAGER_ROLES set commercial-leads uses (which also includes
   operations). 'manager' is this org's CEO role (see
   modules/employees/views/js/main.js's own comment on MANAGE_ROSTER_ROLES);
   admin is included to match that same file's CEO_DASHBOARD_ROLES gate on
   the nav button. Operations does not get a pass here just because it can
   manage users elsewhere. */
function createCeoDashboardRouter({ ceoDashboardController, authenticate }) {
  const router = express.Router();
  const requireManager = requireRole([ROLES.MANAGER, ROLES.ADMIN]);

  router.get('/ceo-dashboard/snapshot', authenticate, requireManager, ceoDashboardController.snapshot);
  router.get('/ceo-dashboard/brief', authenticate, requireManager, ceoDashboardController.brief);

  return router;
}

module.exports = createCeoDashboardRouter;
