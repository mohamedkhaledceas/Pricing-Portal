/* Reliability fix for clickupUserSync: previously ran exactly once, at
   server boot, so a new employee or a ClickUp workspace member who joins
   later never got matched (clickup_user_id stayed null) until the next
   restart. Structurally identical to commercial-leads'
   jobs/reconcile.js#startReconciliationSchedule — same reentrant guard +
   cron + immediate startup run shape, applied to this module's own sync.
   Its interval comes from config (CLICKUP_USER_SYNC_MINUTES). */
const { staggeredMinutes } = require('../../../common/jobs/stagger');
const cron = require('node-cron');
const logger = require('../../../common/logger');
const createClickupUserSync = require('../services/clickupUserSync');
const config = require('../../../config');

function startClickupUserSyncSchedule({ employeeRepository, clickupClient, teamId }) {
  const clickupUserSync = createClickupUserSync({ employeeRepository, clickupClient, teamId });

  let isRunning = false;
  async function runOnce(trigger) {
    if (isRunning) {
      logger.warn('ClickUp user sync already in progress — skipping this trigger.', { trigger });
      return;
    }
    isRunning = true;
    try {
      await clickupUserSync.run();
    } catch (error) {
      // clickupUserSync.run() already catches/logs its own known failure
      // modes (team fetch failing) — this only catches something
      // unexpected escaping that.
      logger.error('ClickUp user sync run failed unexpectedly.', { trigger, message: error.message, stack: error.stack });
    } finally {
      isRunning = false;
    }
  }

  const minutes = config.clickupUserSyncMinutes;
  cron.schedule(`${staggeredMinutes(minutes, 18)} * * * *`, () => runOnce('scheduled'));
  logger.info(`ClickUp user sync scheduled every ${minutes} minute(s).`);

  // Startup runs are spaced out so the ClickUp syncs don't all hit its rate limit at once.
  setTimeout(() => { runOnce('startup'); }, 20000);

  return clickupUserSync;
}

module.exports = startClickupUserSyncSchedule;
