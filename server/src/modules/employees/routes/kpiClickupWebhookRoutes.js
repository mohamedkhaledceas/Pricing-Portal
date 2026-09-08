const express = require('express');

/* Mounted directly at /api/employees/kpi/clickup-webhook in src/index.js,
   BEFORE the app-wide express.json() — same reasoning as commercial-leads'
   own webhookRoutes.js: this route carries its own express.raw() parser so
   the exact bytes ClickUp sent are still available for HMAC signature
   verification. No authenticate middleware — the caller is ClickUp, not a
   logged-in portal user; see kpiClickupWebhookController for how
   authenticity is actually verified. */
function createKpiClickupWebhookRouter({ kpiClickupWebhookController }) {
  const router = express.Router();

  router.post('/', express.raw({ type: 'application/json', limit: '2mb' }), kpiClickupWebhookController.receive);

  return router;
}

module.exports = createKpiClickupWebhookRouter;
