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
const createBudgetService = require('./services/budgetService');
const budgetRepository = require('./repositories/budgetRepository');
const createTargetService = require('./services/targetService');
const createEscalationService = require('./services/escalationService');
const escalationRepository = require('./repositories/escalationRepository');
const targetRepository = require('./repositories/targetRepository');
const { transaction } = require('./repositories/unitOfWork');
const controlRoomSample = require('./repositories/data/controlRoomSample.json');
const audit = require('../../../common/audit');
const createCeoDashboardController = require('./controllers/ceoDashboardController');
const createCeoDashboardRouter = require('./routes/index');

const { authenticate } = require('../../auth');
// Each live source through its owner's public interface — never its
// repositories (ADR-0013 §3 for finance; same rule for the other two).
const { financeMetricsService, customerLedgerService } = require('../finance/container');
const { getPipelineSummary, getClientDeals, getDealsForClient } = require('../commercial-leads/container');
const { clickupGet } = require('../../../common/integrations/clickupClient');
const { CLIENT_NAME_FIELD_ID } = require('../clients/container');
const { getWorkforceSummary } = require('../../employees');

const budgetService = createBudgetService({ budgetRepository, audit });
const escalationService = createEscalationService({ escalationRepository, audit });
const targetService = createTargetService({
  targetRepository,
  transaction,
  audit,
  knownKpiIds: controlRoomSample.kpis.map((k) => k.id),
  componentIds: controlRoomSample.components.map((c) => c.id),
});
const controlRoomService = createControlRoomService({
  sampleRepository: createControlRoomSampleRepository(),
  budgetService,
  targetService,
  escalationService,
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
  clientTasksService: createClientTasksService({ clickupGet, clientNameFieldId: CLIENT_NAME_FIELD_ID }),
  logger,
});
const ceoDashboardController = createCeoDashboardController({
  controlRoomService, clientBookService, budgetService, targetService, escalationService,
});
const router = createCeoDashboardRouter({ ceoDashboardController, authenticate });

module.exports = { router };
