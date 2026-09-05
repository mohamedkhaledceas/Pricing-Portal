/* Reliability fix for clickupUserSync: previously ran exactly once, at
   server boot, so a new employee or a ClickUp workspace member who joins
   later never got matched (clickup_user_id stayed null) until the next
   restart. Structurally identical to commercial-leads'
   jobs/reconcile.js#startReconciliationSchedule — same reentrant guard +
   cron + immediate startup run shape, applied to this module's own sync.

   process.env read directly here, not through config/index.js — same
   already-documented carve-out config/index.js's own header comment
   states for clickupReconcile.js and friends (centralizing those is a
   separate pass, not this one). */
const cron = require('node-cron');
const logger = require('../../../common/logger');
const createClickupUserSync = require('../services/clickupUserSync');

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

  const minutes = Number(process.env.CLICKUP_USER_SYNC_MINUTES || 30);
  cron.schedule(`*/${minutes} * * * *`, () => runOnce('scheduled'));
  logger.info(`ClickUp user sync scheduled every ${minutes} minute(s).`);

  runOnce('startup');

  return clickupUserSync;
}

module.exports = startClickupUserSyncSchedule;
