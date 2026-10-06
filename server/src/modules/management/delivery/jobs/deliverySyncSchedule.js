/* Refreshes the ClickUp delivery copy every SYNC_INTERVAL_MINUTES and once
   at startup. */
const { staggeredMinutes } = require('../../../../common/jobs/stagger');
const cron = require('node-cron');
const { SYNC_INTERVAL_MINUTES } = require('../constants');

function startDeliverySyncSchedule({ deliverySyncService, logger }) {
  const runOnce = () => deliverySyncService.sync().catch((error) => {
    // sync() records its own failures; this only catches something unexpected escaping it.
    logger.error('ClickUp delivery sync run failed unexpectedly.', { message: error.message });
  });
  cron.schedule(`${staggeredMinutes(SYNC_INTERVAL_MINUTES, 7)} * * * *`, runOnce);
  logger.info(`ClickUp delivery sync scheduled every ${SYNC_INTERVAL_MINUTES} minute(s).`);
  // Startup runs are spaced out so the ClickUp syncs don't all hit its rate limit at once.
  setTimeout(() => { runOnce(); }, 90000);
}

module.exports = { startDeliverySyncSchedule };
