/* Schedules odooSyncService — same reentrant-guard + cron + immediate
   startup run shape as commercial-leads/jobs/reconcile.js. One guard
   covers both modes so an incremental and a full run never overlap.

   Startup runs a full sync: on a fresh database that is the initial load,
   and on an existing one it also catches deletions made while the server
   was down. Full sync again nightly at 03:00 Cairo time. */
const cron = require('node-cron');

function startOdooSyncSchedule({ odooSyncService, dataCheckService, logger, intervalMinutes }) {
  let isRunning = false;

  async function runOnce(mode, trigger) {
    if (isRunning) {
      logger.warn('Odoo sync already in progress — skipping this trigger.', { mode, trigger });
      return;
    }
    isRunning = true;
    const startedAt = Date.now();
    try {
      const results = mode === 'full' ? await odooSyncService.runFull() : await odooSyncService.runIncremental();
      logger.info('Odoo sync completed.', { mode, trigger, durationMs: Date.now() - startedAt, results });
      // After a full copy, check it still matches Odoo (dataCheckService).
      if (mode === 'full' && dataCheckService) await dataCheckService.run();
    } catch (error) {
      // syncModel already records/logs per-model failures — this only
      // catches something unexpected escaping that.
      logger.error('Odoo sync run failed unexpectedly.', { mode, trigger, message: error.message, stack: error.stack });
    } finally {
      isRunning = false;
    }
  }

  cron.schedule(`*/${intervalMinutes} * * * *`, () => runOnce('incremental', 'scheduled'));
  cron.schedule('0 3 * * *', () => runOnce('full', 'nightly'), { timezone: 'Africa/Cairo' });
  logger.info(`Odoo sync scheduled every ${intervalMinutes} minute(s), full sync nightly at 03:00 Africa/Cairo.`);

  runOnce('full', 'startup');
}

module.exports = { startOdooSyncSchedule };
