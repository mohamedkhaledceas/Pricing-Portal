/* Receives the KPI-specific ClickUp webhook (team-wide subscription, see
   scripts/clickup/register-kpi-webhook.js) — a separate registration from
   commercial-leads' own folder-scoped one, since KPI-relevant lists span
   multiple spaces/folders. Same signature-verification logic
   (common/integrations/clickupWebhookAuth.js), a different secret
   (CLICKUP_KPI_WEBHOOK_SECRET), a different downstream service. */
const logger = require('../../../common/logger');
const { verifyClickupSignature } = require('../../../common/integrations/clickupWebhookAuth');

function createKpiClickupWebhookController({ kpiClickupSyncService }) {
  function receive(req, res) {
    const secret = process.env.CLICKUP_KPI_WEBHOOK_SECRET;
    if (!secret) {
      logger.error('CLICKUP_KPI_WEBHOOK_SECRET is not configured — rejecting KPI ClickUp webhook.', {
        correlationId: req.correlationId,
      });
      return res.status(500).end();
    }

    const signature = req.headers['x-signature'];
    if (!verifyClickupSignature(req.body, signature, secret)) {
      logger.warn('Rejected KPI ClickUp webhook with invalid/missing signature.', {
        correlationId: req.correlationId,
      });
      return res.status(401).end();
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (error) {
      logger.warn('Rejected KPI ClickUp webhook with unparseable body.', { correlationId: req.correlationId });
      return res.status(400).end();
    }

    // Ack fast, same reasoning as the commercial-leads webhook receiver —
    // ClickUp expects a prompt 200 and retries on slow/failing responses.
    res.status(200).end();
    kpiClickupSyncService.safeHandleEvent(payload);
  }

  return { receive };
}

module.exports = { createKpiClickupWebhookController };
