/* Manual factory-function DI (ADR-0006) — composition root for this
   module. Nothing outside this file should import pricing's services/
   repositories/models directly. The modules/pricing extraction (see
   docs/migration-plan.md M3) is complete as of this file — every legacy
   Planner route now lives here, fully layered. */
/* teamRepository/teamMember.model.js (team_members table) are no longer
   wired in here — Team & Salaries now sources from real employees
   (migrations 028-030, tracker §4 item 8). Deliberately not deleted (files
   or table) per the user's own "no delete this" instruction — orphaned,
   inert, safe to remove later once nothing else could plausibly need them. */
const settingsRepository = require('./repositories/settingsRepository');
const expenseRepository = require('./repositories/expenseRepository');
const projectRepository = require('./repositories/projectRepository');
// project_lines.js (loose person_id -> team_members) is likewise orphaned
// now — replaced by projectAssignmentRepository (project_assignments,
// employee_id, migration 030). Same "not deleted" reasoning as above.
const projectAssignmentRepository = require('./repositories/projectAssignmentRepository');
const directCostRepository = require('./repositories/directCostRepository');
const scenarioRepository = require('./repositories/scenarioRepository');
const quoteLineRepository = require('./repositories/quoteLineRepository');
const appStateRepository = require('./repositories/appStateRepository');
const auditLogRepository = require('./repositories/auditLogRepository');
const unitOfWork = require('./repositories/unitOfWork');

const settingsModel = require('./models/settings.model');
const expenseModel = require('./models/expense.model');
const projectModel = require('./models/project.model');
const historyEntryModel = require('./models/historyEntry.model');

const audit = require('../../common/audit');
const requireRole = require('../../common/middleware/requireRole');
const { USER_MANAGER_ROLES, COMPENSATION_ROLES, canViewCompensation, canEditCompensation } = require('../../common/permissions');
const { authenticate } = require('../auth');
// Team & Salaries interface (migrations 028-030, tracker §4 item 8) —
// pricing never requires employees' repositories/models directly, only
// this module's own declared public interface, same pattern already used
// for `authenticate` above.
const employeesModule = require('../employees');
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
// De-duplicated via Set — COMPENSATION_ROLES and USER_MANAGER_ROLES both
// include admin/ceo, no reason for requireRole to see the role twice.
const requireTeamViewAccess = requireRole([...new Set([...USER_MANAGER_ROLES, ...COMPENSATION_ROLES])]);
const requireTeamEditAccess = requireRole(COMPENSATION_ROLES);

const settingsService = createSettingsService({ settingsRepository, settingsModel, audit });
const teamService = createTeamService({
  listEmployeesForPlanner: employeesModule.listEmployeesForPlanner,
  updateEmployeeCompensation: employeesModule.updateEmployeeCompensation,
  canViewCompensation, canEditCompensation,
});
const expenseService = createExpenseService({ expenseRepository, expenseModel, audit, generateId });
const projectService = createProjectService({
  projectRepository, projectAssignmentRepository, directCostRepository, scenarioRepository,
  quoteLineRepository, appStateRepository, auditLogRepository, unitOfWork,
  projectModel, historyEntryModel, audit, generateId,
});
const stateService = createStateService({
  settingsRepository, settingsModel,
  listEmployeesForPlanner: employeesModule.listEmployeesForPlanner, canViewCompensation,
  expenseRepository, expenseModel, projectRepository, projectAssignmentRepository,
  directCostRepository, scenarioRepository, quoteLineRepository, projectModel,
  appStateRepository,
});
const companyCostInputsService = createCompanyCostInputsService({
  settingsRepository, settingsModel, listEmployeesForPlanner: employeesModule.listEmployeesForPlanner, expenseRepository, expenseModel,
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
  requireTeamViewAccess,
  requireTeamEditAccess,
});

module.exports = {
  router,
  // Narrow cross-module interface — see companyCostInputsService.js. Only
  // export from this module marginPlannerSummary.js (outside any module,
  // used by modules/management/ceo-dashboard) should ever call.
  readCompanyCostInputs: companyCostInputsService.readCompanyCostInputs,
};
