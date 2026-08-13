const crypto = require('crypto');
const express = require('express');
const logger = require('./common/logger');
const { emitClickupEvent } = require('./realtime');

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

    logger.info('ClickUp webhook verified', {
      correlationId: req.correlationId,
      event: payload.event,
      taskId: payload.task_id || null,
      historyItems: (payload.history_items || []).length,
    });

    /* Ack fast, before broadcasting — ClickUp expects a prompt 200 and will
       retry/back off on slow or failing responses; nothing downstream of
       this should be able to delay or fail that ack. */
    res.status(200).end();

    /* Phase 2: broadcast the raw verified payload as-is. Turning it into DB
       writes (stage tracking/history, daily counts) is Phase 3's
       clickupSync.js — not wired in yet, so the browser is the only
       consumer of this event for now. */
    emitClickupEvent(payload);
  });

  return router;
}

module.exports = { clickupWebhookRouter, verifySignature };
