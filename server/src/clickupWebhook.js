const crypto = require('crypto');
const express = require('express');
const logger = require('./common/logger');

/* No authMiddleware here — the caller is ClickUp, not a logged-in portal
   user. Authenticity is instead verified via the HMAC-SHA256 signature
   ClickUp sends in X-Signature, computed over the exact raw request bytes
   with the secret returned when the webhook was registered
   (scripts/clickup/register-webhook.js). This requires the raw body, which
   is why this route carries its own express.raw() middleware instead of
   relying on the app-wide express.json() — by the time a request reaches
   that global parser the raw bytes are already gone. */
function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const signatureBuf = Buffer.from(signatureHeader, 'hex');
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

function clickupWebhookRouter() {
  const router = express.Router();

  router.post('/', express.raw({ type: 'application/json', limit: '2mb' }), (req, res) => {
    const secret = process.env.CLICKUP_WEBHOOK_SECRET;
    if (!secret) {
      logger.error('CLICKUP_WEBHOOK_SECRET is not configured — rejecting ClickUp webhook.');
      return res.status(500).end();
    }

    const signature = req.headers['x-signature'];
    if (!verifySignature(req.body, signature, secret)) {
      logger.warn('Rejected ClickUp webhook with invalid/missing signature.', {
        correlationId: req.correlationId,
      });
      return res.status(401).end();
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (error) {
      logger.warn('Rejected ClickUp webhook with unparseable body.', { correlationId: req.correlationId });
      return res.status(400).end();
    }

    /* Phase 1: verify + log only. Once the DB tables and clickupSync.js
       exist, this becomes: clickupSync.handleEvent(payload) then emit over
       Socket.IO — kept as a bare log for now so the receiver/signature path
       can be proven correct on its own before anything downstream depends
       on it. */
    logger.info('ClickUp webhook verified', {
      correlationId: req.correlationId,
      event: payload.event,
      taskId: payload.task_id || null,
      historyItems: (payload.history_items || []).length,
    });

    /* Ack fast — ClickUp expects a prompt 200 and will retry/back off on
       slow or failing responses. */
    res.status(200).end();
  });

  return router;
}

module.exports = { clickupWebhookRouter, verifySignature };
