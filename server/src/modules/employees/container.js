/* Manual factory-function DI (ADR-0006) — composition root for this
   module. Nothing outside this file should import employees' services/
   repositories/models directly. */
const employeeRepository = require('./repositories/employeeRepository');
const leaveRequestRepository = require('./repositories/leaveRequestRepository');
const conflictPairRepository = require('./repositories/conflictPairRepository');
const departmentRepository = require('./repositories/departmentRepository');
const kpiDefinitionRepository = require('./repositories/kpiDefinitionRepository');
const kpiScoreRepository = require('./repositories/kpiScoreRepository');
const pillarAReviewRepository = require('./repositories/pillarAReviewRepository');
const selfEvaluationRepository = require('./repositories/selfEvaluationRepository');
const kpiNotificationRepository = require('./repositories/kpiNotificationRepository');
const kpiEmployeeTargetRepository = require('./repositories/kpiEmployeeTargetRepository');
const kpiClickupStatusEventRepository = require('./repositories/kpiClickupStatusEventRepository');
const kpiAutoMetricMappingRepository = require('./repositories/kpiAutoMetricMappingRepository');
const kpiClickupListRepository = require('./repositories/kpiClickupListRepository');
const kpiPeerReviewRepository = require('./repositories/kpiPeerReviewRepository');
const kpiReviewWindowRepository = require('./repositories/kpiReviewWindowRepository');
const employeeProfileChangeRequestRepository = require('./repositories/employeeProfileChangeRequestRepository');
const employeeModel = require('./models/employee.model');
const leaveRequestModel = require('./models/leaveRequest.model');
const conflictPairModel = require('./models/conflictPair.model');
const departmentModel = require('./models/department.model');
const profileChangeRequestModel = require('./models/profileChangeRequest.model');

const audit = require('../../common/audit');
const logger = require('../../common/logger');
const { ROLES } = require('../../common/constants/roles');
const { authenticate } = require('../auth');
const clickupClient = require('../../common/integrations/clickupClient');

// "The Ceas Workplace" — confirmed via GET /team during discovery, same
// team id commercial-leads' own scripts already hardcode.
const CLICKUP_TEAM_ID = '36181979';

const timeOffRules = require('./services/timeOffRules');
const leaveBalanceRules = require('./services/leaveBalanceRules');
const teamMembership = require('./services/teamMembership');
const kpiFrameworkSeed = require('./services/kpiFrameworkSeed.data');
const createAttachEmployeeMiddleware = require('./middleware/attachEmployee');
const { deleteStoredPhoto, UPLOAD_DIR: employeePhotoUploadDir } = require('./middleware/photoUpload');
const createRosterService = require('./services/rosterService');
const createTimeOffService = require('./services/timeOffService');
const createConflictPairService = require('./services/conflictPairService');
const createDepartmentService = require('./services/departmentService');
const createKpiScoringService = require('./services/kpiScoringService');
const createClickupLeaveSync = require('./services/clickupLeaveSync');
const createKpiClickupMetricsService = require('./services/kpiClickupMetricsService');
const createKpiClickupSyncService = require('./services/kpiClickupSyncService');
const createKpiPeerReviewService = require('./services/kpiPeerReviewService');
const startClickupUserSyncSchedule = require('./jobs/clickupUserSyncSchedule');
const { startKpiClickupListSyncSchedule } = require('./jobs/kpiClickupListSync');
const createRosterController = require('./controllers/rosterController');
const createTimeOffController = require('./controllers/timeOffController');
const createConflictPairController = require('./controllers/conflictPairController');
const createDepartmentController = require('./controllers/departmentController');
const createKpiController = require('./controllers/kpiController');
const { createKpiClickupWebhookController } = require('./controllers/kpiClickupWebhookController');
const createEmployeesRouter = require('./routes/index');
const createKpiClickupWebhookRouter = require('./routes/kpiClickupWebhookRoutes');

// Idempotent — INSERT OR IGNORE against the UNIQUE(kpi_profile, metric_id,
// effective_quarter) constraint, safe to run every boot. Seeds both the
// quarter this framework was transcribed against (a historical record)
// and whatever the live current quarter is right now, so a new quarter
// starting never leaves Pillar B silently undefined until someone
// remembers to re-run a seed script by hand.
kpiDefinitionRepository.seedMany(kpiFrameworkSeed.forQuarter(kpiFrameworkSeed.BASELINE_QUARTER));
kpiDefinitionRepository.seedMany(kpiFrameworkSeed.forQuarter(kpiScoreRepository.getCurrentQuarter()));

const attachEmployee = createAttachEmployeeMiddleware({ employeeRepository, employeeModel });

// Schedules the recurring sync (+ runs once immediately, fire-and-forget —
// a ClickUp outage at boot must never block the app from starting; errors
// are caught and logged inside clickupUserSync.run() itself) and returns
// the same sync object so rosterService can also trigger it on demand
// right after a new employee is created, instead of that employee waiting
// for the next scheduled tick.
const clickupUserSync = startClickupUserSyncSchedule({ employeeRepository, clickupClient });

const rosterService = createRosterService({
  employeeRepository, employeeModel, leaveRequestRepository, employeeProfileChangeRequestRepository,
  profileChangeRequestModel, audit, roles: ROLES, deleteStoredPhoto, clickupUserSync, departmentRepository,
  teamMembership,
});
const clickupLeaveSync = createClickupLeaveSync({ clickupClient, employeeRepository, timeOffRules });
const conflictPairService = createConflictPairService({ conflictPairRepository, conflictPairModel, leaveRequestRepository, employeeRepository, audit, roles: ROLES });
const timeOffService = createTimeOffService({ leaveRequestRepository, employeeRepository, leaveRequestModel, timeOffRules, leaveBalanceRules, audit, clickupLeaveSync, conflictPairService, roles: ROLES });
const kpiClickupMetricsService = createKpiClickupMetricsService({
  clickupGet: clickupClient.clickupGet, teamId: CLICKUP_TEAM_ID, kpiClickupStatusEventRepository,
});
const kpiScoringService = createKpiScoringService({
  employeeRepository, employeeModel, departmentRepository, kpiDefinitionRepository, kpiScoreRepository,
  pillarAReviewRepository, selfEvaluationRepository, kpiNotificationRepository,
  kpiEmployeeTargetRepository, kpiAutoMetricMappingRepository, kpiClickupMetricsService,
  audit, roles: ROLES, logger, teamMembership,
});
const departmentService = createDepartmentService({ departmentRepository, departmentModel, audit, roles: ROLES });
const kpiClickupSyncService = createKpiClickupSyncService({
  clickupGet: clickupClient.clickupGet, employeeRepository, kpiClickupStatusEventRepository,
});
const kpiPeerReviewService = createKpiPeerReviewService({
  employeeRepository, pillarAReviewRepository, kpiPeerReviewRepository, kpiReviewWindowRepository, audit, roles: ROLES,
});

// Refreshes the local list/status cache the mapping-admin UI reads from —
// same boot+interval shape as the ClickUp user sync above.
startKpiClickupListSyncSchedule({
  clickupGet: clickupClient.clickupGet, kpiAutoMetricMappingRepository, kpiClickupListRepository,
});

const rosterController = createRosterController({ rosterService });
const timeOffController = createTimeOffController({ timeOffService });
const conflictPairController = createConflictPairController({ conflictPairService });
const kpiController = createKpiController({
  kpiScoringService, employeeRepository, employeeModel, kpiNotificationRepository, kpiClickupListRepository, kpiPeerReviewService, roles: ROLES,
});
const departmentController = createDepartmentController({ departmentService });
const kpiClickupWebhookController = createKpiClickupWebhookController({ kpiClickupSyncService });

const router = createEmployeesRouter({
  rosterController,
  timeOffController,
  conflictPairController,
  kpiController,
  departmentController,
  authenticate,
  attachEmployee,
});
const kpiClickupWebhookRouter = createKpiClickupWebhookRouter({ kpiClickupWebhookController });

/* Exposed narrowly for auth's signup flow to call, via the late-bound
   setter auth/container.js exports (setEmployeeProvisioner) — not a direct
   cross-module require in either direction, avoiding both the module-
   boundary rule and a require() cycle (employees already requires
   modules/auth for `authenticate`; auth requiring employees back would be
   circular). See index.js for where this actually gets wired together. */
module.exports = {
  router,
  provisionSelfRegisteredEmployee: rosterService.createForSelfRegistration,
  // Exposed narrowly so index.js can mount a static route for it — the
  // directory itself is resolved once, in photoUpload.js, not recomputed
  // here or in index.js.
  employeePhotoUploadDir,
  // Mounted directly in index.js, before express.json() — same reasoning
  // as commercial-leads' own webhookRouter export.
  kpiClickupWebhookRouter,
};
