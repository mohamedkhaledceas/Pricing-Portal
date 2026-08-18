const express = require('express');

/* Kept separate from routes/index.js and mounted directly at
   /api/clickup/webhook in app.js — BEFORE the app-wide express.json(),
   exactly as today. This route carries its own express.raw() parser so the
   exact bytes ClickUp sent are still available for HMAC signature
   verification; by the time a request reaches the global express.json(),
   the raw body is already gone. No authenticate middleware here — the
   caller is ClickUp, not a logged-in portal user; see webhookController
   for how authenticity is actually verified. */
function createWebhookRouter({ webhookController }) {
  const router = express.Router();

  router.post('/', express.raw({ type: 'application/json', limit: '2mb' }), webhookController.receive);

  return router;
}

module.exports = createWebhookRouter;
