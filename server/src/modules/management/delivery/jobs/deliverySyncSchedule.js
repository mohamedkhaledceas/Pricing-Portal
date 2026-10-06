/* Refreshes the ClickUp delivery copy: changed tasks every
   SYNC_INTERVAL_MINUTES, the whole copy at startup and nightly at 03:30
   Cairo (after Odoo's 03:00 full run). */
const { staggeredMinutes } = require('../../../../common/jobs/stagger');
const cron = require('node-cron');
const { SYNC_INTERVAL_MINUTES } = require('../constants');

function startDeliverySyncSchedule({ deliverySyncService, logger }) {
  const runOnce = (mode) => deliverySyncService.sync({ mode }).catch((error) => {
    // sync() records its own failures; this only catches something unexpected escaping it.
    logger.error('ClickUp delivery sync run failed unexpectedly.', { message: error.message });
  });
  cron.schedule(`${staggeredMinutes(SYNC_INTERVAL_MINUTES, 7)} * * * *`, () => runOnce('incremental'));
  cron.schedule('30 3 * * *', () => runOnce('full'), { timezone: 'Africa/Cairo' });
  logger.info(`ClickUp delivery sync scheduled every ${SYNC_INTERVAL_MINUTES} minute(s).`);
  // Startup runs are spaced out so the ClickUp syncs don't all hit its rate limit at once.
  setTimeout(() => { runOnce('full'); }, 90000);
}

module.exports = { startDeliverySyncSchedule };
