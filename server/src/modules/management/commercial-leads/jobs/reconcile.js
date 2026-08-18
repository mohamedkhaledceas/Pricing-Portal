/* Safety net underneath the webhook/Socket.IO path, not the primary sync
   mechanism — catches anything a missed webhook delivery would otherwise
   leave permanently wrong (a stale status, a deal ClickUp deleted that we
   never heard about). Runs on a timer AND once immediately on startup —
   that startup run is also what backfills every deal that existed in
   ClickUp before this system started listening for webhooks at all.
   Extracted unchanged from clickupReconcile.js. */
const cron = require('node-cron');
const logger = require('../../../../common/logger');
const { runReconciliation } = require('../services/clickupSyncService');

let isRunning = false;

async function runOnce(trigger) {
  if (isRunning) {
    logger.warn('ClickUp reconciliation already in progress — skipping this trigger.', { trigger });
    return;
  }
  isRunning = true;
  const startedAt = Date.now();
  try {
    await runReconciliation();
    logger.info('ClickUp reconciliation completed.', { trigger, durationMs: Date.now() - startedAt });
  } catch (error) {
    // runReconciliation already isolates per-list failures — this only
    // catches something unexpected escaping that isolation.
    logger.error('ClickUp reconciliation run failed unexpectedly.', {
      trigger,
      message: error.message,
      stack: error.stack,
    });
  } finally {
    isRunning = false;
  }
}

function startReconciliationSchedule() {
  const minutes = Number(process.env.CLICKUP_RECONCILE_MINUTES || 30);
  cron.schedule(`*/${minutes} * * * *`, () => runOnce('scheduled'));
  logger.info(`ClickUp reconciliation scheduled every ${minutes} minute(s).`);

  runOnce('startup');
}

module.exports = { startReconciliationSchedule };
