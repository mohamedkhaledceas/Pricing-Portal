/* Authenticity is verified via the HMAC-SHA256 signature ClickUp sends in
   X-Signature, computed over the exact raw request bytes with the secret
   returned when the webhook was registered (scripts/clickup/register-webhook.js).
   Extracted unchanged from clickupWebhook.js. */
const crypto = require('crypto');
const logger = require('../../../../common/logger');

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const signatureBuf = Buffer.from(signatureHeader, 'hex');
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

function createWebhookController({ clickupSyncService }) {
  function receive(req, res) {
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

    /* Ack fast, before syncing — ClickUp expects a prompt 200 and will
       retry/back off on slow or failing responses; nothing downstream of
       this should be able to delay or fail that ack. clickupSyncService
       does its own error handling internally (a failed sync is logged, not
       thrown), so it's deliberately not awaited here — the HTTP response
       doesn't wait on DB writes or the Socket.IO broadcast. */
    res.status(200).end();
    clickupSyncService.handleEvent(payload);
  }

  return { receive };
}

module.exports = { createWebhookController, verifySignature };
