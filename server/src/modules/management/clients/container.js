/* Composition root for management/clients — the portal's client list,
   kept in step with ClickUp's "Client Name" dropdown (migration 034):
   repositories -> clickupClientSyncService -> controller -> router, plus
   the 30-minute + startup schedule. Deals are linked through
   commercial-leads' public linkDealsByClientName, never its repositories. */
const logger = require('../../../common/logger');
const audit = require('../../../common/audit');
const { authenticate } = require('../../auth');
const { clickupGet } = require('../../../common/integrations/clickupClient');
const { linkDealsByClientName } = require('../commercial-leads/container');

const clientRepository = require('./repositories/clientRepository');
const syncStateRepository = require('./repositories/syncStateRepository');
const { transaction } = require('./repositories/unitOfWork');
const createClickupClientSyncService = require('./services/clickupClientSyncService');
const createClientSyncController = require('./controllers/clientSyncController');
const createClientsRouter = require('./routes/index');
const { startClickupClientSyncSchedule } = require('./jobs/clickupClientSyncSchedule');
const { CLIENT_NAME_FIELD_ID } = require('./constants');

const clickupClientSyncService = createClickupClientSyncService({
  clickupGet, clientRepository, syncStateRepository, linkDealsByClientName, transaction, audit, logger,
});
const router = createClientsRouter({
  clientSyncController: createClientSyncController({ clickupClientSyncService }),
  authenticate,
});

module.exports = {
  router,
  clickupClientSyncService,
  CLIENT_NAME_FIELD_ID,
  startClientSyncSchedule: () => startClickupClientSyncSchedule({ clickupClientSyncService, logger }),
};
