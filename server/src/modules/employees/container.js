/* Manual factory-function DI (ADR-0006) — composition root for this
   module. Nothing outside this file should import employees' services/
   repositories/models directly. */
const employeeRepository = require('./repositories/employeeRepository');
const leaveRequestRepository = require('./repositories/leaveRequestRepository');
const conflictPairRepository = require('./repositories/conflictPairRepository');
const kpiDefinitionRepository = require('./repositories/kpiDefinitionRepository');
const kpiScoreRepository = require('./repositories/kpiScoreRepository');
const pillarAReviewRepository = require('./repositories/pillarAReviewRepository');
const employeeProfileChangeRequestRepository = require('./repositories/employeeProfileChangeRequestRepository');
const employeeModel = require('./models/employee.model');
const leaveRequestModel = require('./models/leaveRequest.model');
const conflictPairModel = require('./models/conflictPair.model');
const profileChangeRequestModel = require('./models/profileChangeRequest.model');

const audit = require('../../common/audit');
const { ROLES } = require('../../common/constants/roles');
const { authenticate } = require('../auth');
const clickupClient = require('../../common/integrations/clickupClient');

const timeOffRules = require('./services/timeOffRules');
const kpiFrameworkSeed = require('./services/kpiFrameworkSeed.data');
const createAttachEmployeeMiddleware = require('./middleware/attachEmployee');
const { deleteStoredPhoto, UPLOAD_DIR: employeePhotoUploadDir } = require('./middleware/photoUpload');
const createRosterService = require('./services/rosterService');
const createTimeOffService = require('./services/timeOffService');
const createConflictPairService = require('./services/conflictPairService');
const createKpiScoringService = require('./services/kpiScoringService');
const createClickupLeaveSync = require('./services/clickupLeaveSync');
const startClickupUserSyncSchedule = require('./jobs/clickupUserSyncSchedule');
const createRosterController = require('./controllers/rosterController');
const createTimeOffController = require('./controllers/timeOffController');
const createConflictPairController = require('./controllers/conflictPairController');
const createKpiController = require('./controllers/kpiController');
const createEmployeesRouter = require('./routes/index');

// Idempotent — INSERT OR IGNORE against the UNIQUE(kpi_profile, metric_id,
// effective_quarter) constraint, safe to run every boot.
kpiDefinitionRepository.seedMany(kpiFrameworkSeed);

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
  profileChangeRequestModel, audit, roles: ROLES, deleteStoredPhoto, clickupUserSync,
});
const clickupLeaveSync = createClickupLeaveSync({ clickupClient, employeeRepository, timeOffRules });
const conflictPairService = createConflictPairService({ conflictPairRepository, conflictPairModel, leaveRequestRepository, employeeRepository, roles: ROLES });
const timeOffService = createTimeOffService({ leaveRequestRepository, employeeRepository, leaveRequestModel, timeOffRules, audit, clickupLeaveSync, conflictPairService, roles: ROLES });
const kpiScoringService = createKpiScoringService({ employeeRepository, kpiDefinitionRepository, kpiScoreRepository, pillarAReviewRepository, roles: ROLES });

const rosterController = createRosterController({ rosterService });
const timeOffController = createTimeOffController({ timeOffService });
const conflictPairController = createConflictPairController({ conflictPairService });
const kpiController = createKpiController({ kpiScoringService, pillarAReviewRepository, employeeRepository, employeeModel, roles: ROLES });

const router = createEmployeesRouter({
  rosterController,
  timeOffController,
  conflictPairController,
  kpiController,
  authenticate,
  attachEmployee,
});

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
};
