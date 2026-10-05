/* Composition root for this module — wires the Control Room sample
   repository + the live read interfaces it overlays (finance's metrics,
   commercial-leads' pipeline summary, employees' workforce summary, the
   Margin Planner cost rollup) -> service -> controller -> router.
   Nothing outside this file (or management's own container.js, which just
   re-exports what this one produces) should import this module's
   service/repository directly. */
const logger = require('../../../common/logger');
const marginPlannerSummary = require('../../../marginPlannerSummary');
const createControlRoomSampleRepository = require('./repositories/controlRoomSampleRepository');
const createControlRoomService = require('./services/controlRoomService');
const createClientBookService = require('./services/clientBookService');
const createClientTasksService = require('./services/clientTasksService');
const createCeoDashboardController = require('./controllers/ceoDashboardController');
const createCeoDashboardRouter = require('./routes/index');

const { authenticate } = require('../../auth');
// Each live source through its owner's public interface — never its
// repositories (ADR-0013 §3 for finance; same rule for the other two).
const { financeMetricsService, customerLedgerService } = require('../finance/container');
const { getPipelineSummary, getClientDeals, getDealsForClient } = require('../commercial-leads/container');
const { clickupGet } = require('../../../common/integrations/clickupClient');
const { getWorkforceSummary } = require('../../employees');

const controlRoomService = createControlRoomService({
  sampleRepository: createControlRoomSampleRepository(),
  financeMetricsService,
  getPipelineSummary,
  getWorkforceSummary,
  getCompanyCostSummary: marginPlannerSummary.getCompanyCostSummary,
  logger,
});
const clientBookService = createClientBookService({
  customerLedgerService,
  getClientDeals,
  getDealsForClient,
  clientTasksService: createClientTasksService({ clickupGet }),
  logger,
});
const ceoDashboardController = createCeoDashboardController({ controlRoomService, clientBookService });
const router = createCeoDashboardRouter({ ceoDashboardController, authenticate });

module.exports = { router };
