const express = require('express');

/* Mounted at /api in app.js, so these paths resolve exactly as they do
   today: /api/commercial-lead/deals, /stats, /stage-durations,
   /status-colors, /quarterly-kpis, and /api/clickup/survey — unchanged, so
   commercial-lead.html and any other caller keep working without a
   frontend change. (The webhook route is separate — see webhookRoutes.js —
   since it needs its own raw-body middleware mounted before express.json(),
   an app-assembly-level concern, not this router's.) */
function createCommercialLeadsRouter({ dealsController, authenticate }) {
  const router = express.Router();

  router.get('/clickup/survey', authenticate, dealsController.clickupSurvey);

  router.get('/commercial-lead/deals', authenticate, dealsController.deals);
  router.get('/commercial-lead/stats', authenticate, dealsController.stats);
  router.get('/commercial-lead/stage-durations', authenticate, dealsController.stageDurations);
  router.get('/commercial-lead/status-colors', authenticate, dealsController.statusColors);
  router.get('/commercial-lead/quarterly-kpis', authenticate, dealsController.quarterlyKpis);

  return router;
}

module.exports = createCommercialLeadsRouter;
