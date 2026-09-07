/* Refreshes kpi_clickup_lists — real, current list name/statuses — for
   every list ID referenced by any active kpi_auto_metric_mapping. This is
   what lets the mapping-admin UI show a real, current status dropdown
   instead of a hand-typed string that might already be stale (a list's
   statuses can be renamed by whoever manages it in ClickUp). Structurally
   the same boot+interval cron shape jobs/clickupUserSyncSchedule.js
   already uses. */
const cron = require('node-cron');
const logger = require('../../../common/logger');

function createKpiClickupListSync({ clickupGet, kpiAutoMetricMappingRepository, kpiClickupListRepository }) {
  async function run() {
    const mappings = kpiAutoMetricMappingRepository.findAllActive();
    const listIds = new Set();
    mappings.forEach((m) => (m.config.listIds || []).forEach((id) => listIds.add(String(id))));

    let synced = 0;
    for (const listId of listIds) {
      try {
        const list = await clickupGet(`/list/${listId}`);
        kpiClickupListRepository.upsert({
          clickupListId: listId,
          name: list.name,
          spaceName: list.space ? list.space.name : null,
          folderName: list.folder ? list.folder.name : null,
          statuses: (list.statuses || []).map((s) => ({ status: s.status, type: s.type })),
        });
        synced += 1;
      } catch (error) {
        // A deleted/renamed list ID still referenced by a mapping — logged
        // so the mapping-admin UI can flag it, never thrown (one bad list
        // ID can't block syncing every other one).
        logger.warn('kpiClickupListSync: could not sync list', { listId, error: error.message });
      }
    }
    if (synced > 0) logger.info(`KPI ClickUp list sync: refreshed ${synced} list(s).`);
  }

  return { run };
}

function startKpiClickupListSyncSchedule({ clickupGet, kpiAutoMetricMappingRepository, kpiClickupListRepository }) {
  const sync = createKpiClickupListSync({ clickupGet, kpiAutoMetricMappingRepository, kpiClickupListRepository });

  let isRunning = false;
  async function runOnce(trigger) {
    if (isRunning) {
      logger.warn('KPI ClickUp list sync already in progress — skipping this trigger.', { trigger });
      return;
    }
    isRunning = true;
    try {
      await sync.run();
    } catch (error) {
      logger.error('KPI ClickUp list sync run failed unexpectedly.', { trigger, message: error.message, stack: error.stack });
    } finally {
      isRunning = false;
    }
  }

  const minutes = Number(process.env.KPI_CLICKUP_LIST_SYNC_MINUTES || 60);
  cron.schedule(`*/${minutes} * * * *`, () => runOnce('scheduled'));
  logger.info(`KPI ClickUp list sync scheduled every ${minutes} minute(s).`);

  runOnce('startup');

  return sync;
}

module.exports = { createKpiClickupListSync, startKpiClickupListSyncSchedule };
