/* Manual factory-function DI (ADR-0006) — composition root for this
   module. Nothing outside this file should import pricing's services/
   repositories/models directly. The modules/pricing extraction (see
   docs/migration-plan.md M3) is complete as of this file — every legacy
   Planner route now lives here, fully layered. */
const settingsRepository = require('./repositories/settingsRepository');
const teamRepository = require('./repositories/teamRepository');
const expenseRepository = require('./repositories/expenseRepository');
const projectRepository = require('./repositories/projectRepository');
const projectLineRepository = require('./repositories/projectLineRepository');
const directCostRepository = require('./repositories/directCostRepository');
const scenarioRepository = require('./repositories/scenarioRepository');
const quoteLineRepository = require('./repositories/quoteLineRepository');
const appStateRepository = require('./repositories/appStateRepository');
const auditLogRepository = require('./repositories/auditLogRepository');
const unitOfWork = require('./repositories/unitOfWork');

const settingsModel = require('./models/settings.model');
const teamMemberModel = require('./models/teamMember.model');
const expenseModel = require('./models/expense.model');
const projectModel = require('./models/project.model');
const historyEntryModel = require('./models/historyEntry.model');

const audit = require('../../common/audit');
const requireRole = require('../../common/middleware/requireRole');
const { USER_MANAGER_ROLES } = require('../../common/permissions');
const { authenticate } = require('../auth');
const generateId = require('../../utils/generateId');

const createSettingsService = require('./services/settingsService');
const createTeamService = require('./services/teamService');
const createExpenseService = require('./services/expenseService');
const createProjectService = require('./services/projectService');
const createStateService = require('./services/stateService');
const createCompanyCostInputsService = require('./services/companyCostInputsService');

const createSettingsController = require('./controllers/settingsController');
const createTeamController = require('./controllers/teamController');
const createExpenseController = require('./controllers/expenseController');
const createProjectController = require('./controllers/projectController');
const createStateController = require('./controllers/stateController');

const createPricingRouter = require('./routes/index');

const requirePlannerAccess = requireRole(USER_MANAGER_ROLES);

const settingsService = createSettingsService({ settingsRepository, settingsModel, audit });
const teamService = createTeamService({ teamRepository, teamMemberModel, projectLineRepository, unitOfWork, audit, generateId });
const expenseService = createExpenseService({ expenseRepository, expenseModel, audit, generateId });
const projectService = createProjectService({
  projectRepository, projectLineRepository, directCostRepository, scenarioRepository,
  quoteLineRepository, appStateRepository, auditLogRepository, unitOfWork,
  projectModel, historyEntryModel, audit, generateId,
});
const stateService = createStateService({
  settingsRepository, settingsModel, teamRepository, teamMemberModel,
  expenseRepository, expenseModel, projectRepository, projectLineRepository,
  directCostRepository, scenarioRepository, quoteLineRepository, projectModel,
  appStateRepository,
});
const companyCostInputsService = createCompanyCostInputsService({
  settingsRepository, settingsModel, teamRepository, teamMemberModel, expenseRepository, expenseModel,
});

const settingsController = createSettingsController({ settingsService });
const teamController = createTeamController({ teamService });
const expenseController = createExpenseController({ expenseService });
const projectController = createProjectController({ projectService });
const stateController = createStateController({ stateService });

const router = createPricingRouter({
  settingsController,
  teamController,
  expenseController,
  projectController,
  stateController,
  authenticate,
  requirePlannerAccess,
});

module.exports = {
  router,
  // Narrow cross-module interface — see companyCostInputsService.js. Only
  // export from this module marginPlannerSummary.js (outside any module,
  // used by modules/management/ceo-dashboard) should ever call.
  readCompanyCostInputs: companyCostInputsService.readCompanyCostInputs,
};
