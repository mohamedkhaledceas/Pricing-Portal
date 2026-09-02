/* Manual factory-function DI (ADR-0006) — the single place concrete
   repositories/services/controllers get wired together. Nothing outside
   this file imports auth's services/repositories/models directly (see
   index.js below, which only exposes the composed router + middleware). */
const userRepository = require('./repositories/userRepository');
const refreshTokenRepository = require('./repositories/refreshTokenRepository');
const { transaction } = require('./repositories/unitOfWork');
const userModel = require('./models/user.model');
const { hashPassword, comparePassword } = require('./utils/hash');
const { signAccessToken, verifyAccessToken } = require('./utils/jwt');
const { setRefreshCookie, clearRefreshCookie, readRefreshCookie } = require('./utils/refreshCookie');

const audit = require('../../common/audit');
const { ROLES, ALL_ROLES } = require('../../common/constants/roles');
const { canManageUsers, canAssignRole, canModifyStatus } = require('../../common/permissions');

const createAuthService = require('./services/authService');
const createAccountAdminService = require('./services/accountAdminService');
const createAuthenticateMiddleware = require('./middleware/authenticate');
const createAuthController = require('./controllers/authController');
const createAccountAdminController = require('./controllers/accountAdminController');
const createAuthRouter = require('./routes/index');

const authService = createAuthService({
  userRepository,
  refreshTokenRepository,
  userModel,
  hashPassword,
  comparePassword,
  signAccessToken,
  audit,
  roles: ROLES,
});

const accountAdminService = createAccountAdminService({
  userRepository,
  refreshTokenRepository,
  userModel,
  audit,
  permissions: { canManageUsers, canAssignRole, canModifyStatus, assignableRoles: ALL_ROLES },
  roles: ROLES,
});

const authenticate = createAuthenticateMiddleware({ userRepository, verifyAccessToken });

/* Mutable holder, set (once, at boot) by index.js via setEmployeeProvisioner
   below — NOT a direct require of modules/employees. Auth must never import
   employees' services (module-boundary rule), and a plain require would be
   circular anyway (employees already requires modules/auth for
   `authenticate`). authController.register reads this at request time,
   after index.js has finished wiring both modules together, so the setter
   is always populated before any real HTTP request can arrive. See
   modules/employees/container.js's provisionSelfRegisteredEmployee for the
   function this ends up holding. */
const employeeProvisioning = { createEmployeeProfile: null };

const authController = createAuthController({
  authService,
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
  transaction,
  employeeProvisioning,
});

const accountAdminController = createAccountAdminController({ accountAdminService, transaction });

const router = createAuthRouter({ authController, accountAdminController, authenticate });

module.exports = {
  router,
  authenticate,
  setEmployeeProvisioner(fn) { employeeProvisioning.createEmployeeProfile = fn; },
};
