/* Manual factory-function DI (ADR-0006) — composition root for this
   module. Nothing outside this file should import employees' services/
   repositories/models directly. */
const employeeRepository = require('./repositories/employeeRepository');
const leaveRequestRepository = require('./repositories/leaveRequestRepository');
const conflictPairRepository = require('./repositories/conflictPairRepository');
const kpiDefinitionRepository = require('./repositories/kpiDefinitionRepository');
const kpiScoreRepository = require('./repositories/kpiScoreRepository');
const pillarAReviewRepository = require('./repositories/pillarAReviewRepository');
const employeeModel = require('./models/employee.model');
const leaveRequestModel = require('./models/leaveRequest.model');
const conflictPairModel = require('./models/conflictPair.model');

const audit = require('../../common/audit');
const { ROLES } = require('../../common/constants/roles');
const { authenticate } = require('../auth');
const clickupClient = require('../../common/integrations/clickupClient');

const timeOffRules = require('./services/timeOffRules');
const kpiFrameworkSeed = require('./services/kpiFrameworkSeed.data');
const createAttachEmployeeMiddleware = require('./middleware/attachEmployee');
const createRosterService = require('./services/rosterService');
const createTimeOffService = require('./services/timeOffService');
const createConflictPairService = require('./services/conflictPairService');
const createKpiScoringService = require('./services/kpiScoringService');
const createClickupLeaveSync = require('./services/clickupLeaveSync');
const createClickupUserSync = require('./services/clickupUserSync');
const createRosterController = require('./controllers/rosterController');
const createTimeOffController = require('./controllers/timeOffController');
const createConflictPairController = require('./controllers/conflictPairController');
const createKpiController = require('./controllers/kpiController');
const createEmployeesRouter = require('./routes/index');

// Idempotent — INSERT OR IGNORE against the UNIQUE(kpi_profile, metric_id,
// effective_quarter) constraint, safe to run every boot.
kpiDefinitionRepository.seedMany(kpiFrameworkSeed);

const attachEmployee = createAttachEmployeeMiddleware({ employeeRepository, employeeModel });

const rosterService = createRosterService({ employeeRepository, employeeModel, audit, roles: ROLES });
const clickupLeaveSync = createClickupLeaveSync({ clickupClient, employeeRepository, timeOffRules });
const timeOffService = createTimeOffService({ leaveRequestRepository, employeeRepository, leaveRequestModel, timeOffRules, audit, clickupLeaveSync, roles: ROLES });
const conflictPairService = createConflictPairService({ conflictPairRepository, conflictPairModel, employeeRepository, roles: ROLES });
const kpiScoringService = createKpiScoringService({ employeeRepository, kpiDefinitionRepository, kpiScoreRepository, pillarAReviewRepository, roles: ROLES });

// Fire-and-forget, same reasoning as clickupLeaveSync's own methods — a
// ClickUp outage at boot must never block the app from starting. Errors
// are caught and logged inside clickupUserSync.run() itself.
createClickupUserSync({ employeeRepository, clickupClient }).run();

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

module.exports = { router };
