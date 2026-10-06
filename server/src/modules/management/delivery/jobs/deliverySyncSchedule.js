/* Refreshes the ClickUp delivery copy every SYNC_INTERVAL_MINUTES and once
   at startup. */
const cron = require('node-cron');
const { SYNC_INTERVAL_MINUTES } = require('../constants');

function startDeliverySyncSchedule({ deliverySyncService, logger }) {
  const runOnce = () => deliverySyncService.sync().catch((error) => {
    // sync() records its own failures; this only catches something unexpected escaping it.
    logger.error('ClickUp delivery sync run failed unexpectedly.', { message: error.message });
  });
  cron.schedule(`*/${SYNC_INTERVAL_MINUTES} * * * *`, runOnce);
  logger.info(`ClickUp delivery sync scheduled every ${SYNC_INTERVAL_MINUTES} minute(s).`);
  runOnce();
}

module.exports = { startDeliverySyncSchedule };
