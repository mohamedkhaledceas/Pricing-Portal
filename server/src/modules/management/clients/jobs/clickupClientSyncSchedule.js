/* Schedules the ClickUp client sync — every SYNC_INTERVAL_MINUTES and
   once at startup. Page loads trigger it too (controllers/), through the
   same service, so all three share its in-flight guard and throttle. */
const { staggeredMinutes } = require('../../../../common/jobs/stagger');
const cron = require('node-cron');
const { SYNC_INTERVAL_MINUTES } = require('../constants');

function startClickupClientSyncSchedule({ clickupClientSyncService, logger }) {
  const runOnce = (trigger) => clickupClientSyncService.sync({ trigger, force: true }).catch((error) => {
    // sync() records its own failures; this only catches something unexpected escaping it.
    logger.error('ClickUp client sync run failed unexpectedly.', { trigger, message: error.message });
  });
  cron.schedule(`${staggeredMinutes(SYNC_INTERVAL_MINUTES, 11)} * * * *`, () => runOnce('scheduled'));
  logger.info(`ClickUp client sync scheduled every ${SYNC_INTERVAL_MINUTES} minute(s), plus on page load.`);
  // Startup runs are spaced out so the ClickUp syncs don't all hit its rate limit at once.
  setTimeout(() => { runOnce('startup'); }, 60000);
}

module.exports = { startClickupClientSyncSchedule };
