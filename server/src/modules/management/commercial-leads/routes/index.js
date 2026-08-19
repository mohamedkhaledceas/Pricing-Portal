const express = require('express');
const requireRole = require('../../../../common/middleware/requireRole');
const { USER_MANAGER_ROLES } = require('../../../../common/permissions');

/* Mounted at /api in app.js, so these paths resolve exactly as they do
   today: /api/commercial-lead/deals, /stats, /stage-durations,
   /status-colors, /quarterly-kpis, and /api/clickup/survey — unchanged, so
   commercial-lead.html and any other caller keep working without a
   frontend change. (The webhook route is separate — see webhookRoutes.js —
   since it needs its own raw-body middleware mounted before express.json(),
   an app-assembly-level concern, not this router's.)

   Every route here is also gated to USER_MANAGER_ROLES — the same role set
   the frontend already uses to decide whether to show the Commercial Lead
   button at all — so that's now an actual access boundary, not just a
   hidden button a curious employee could route around by hitting the API
   directly. requireRole has no dependencies of its own to wire, so it's
   required directly rather than threaded through container.js. */
function createCommercialLeadsRouter({ dealsController, authenticate }) {
  const router = express.Router();
  const requireManager = requireRole(USER_MANAGER_ROLES);

  router.get('/clickup/survey', authenticate, requireManager, dealsController.clickupSurvey);

  router.get('/commercial-lead/deals', authenticate, requireManager, dealsController.deals);
  router.get('/commercial-lead/stats', authenticate, requireManager, dealsController.stats);
  router.get('/commercial-lead/stage-durations', authenticate, requireManager, dealsController.stageDurations);
  router.get('/commercial-lead/status-colors', authenticate, requireManager, dealsController.statusColors);
  router.get('/commercial-lead/quarterly-kpis', authenticate, requireManager, dealsController.quarterlyKpis);

  return router;
}

module.exports = createCommercialLeadsRouter;
