const express = require('express');
const rateLimit = require('express-rate-limit');

/* Mounted at /api in index.js, so these paths resolve exactly as they do
   today: /api/auth/register, /api/auth/login, /api/auth/refresh,
   /api/auth/logout, /api/me, /api/me/profile, /api/me/password, /api/users,
   /api/users/:id/role, /api/users/:id/deactivate, /api/users/:id/reactivate
   — unchanged, so margin-planner_1.html and commercial-lead.html keep
   working without any frontend change. */
function createAuthRouter({ authController, accountAdminController, authenticate }) {
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  });

  const router = express.Router();

  router.post('/auth/register', authLimiter, authController.register);
  router.post('/auth/login', authLimiter, authController.login);
  router.post('/auth/refresh', authLimiter, authController.refresh);
  router.post('/auth/logout', authController.logout);

  router.get('/me', authenticate, authController.getMe);
  router.patch('/me/profile', authenticate, authController.updateProfile);
  router.patch('/me/password', authenticate, authController.changePassword);

  router.get('/users', authenticate, accountAdminController.listUsers);
  router.patch('/users/:id/role', authenticate, accountAdminController.changeRole);
  router.post('/users/:id/deactivate', authenticate, accountAdminController.deactivate);
  router.post('/users/:id/reactivate', authenticate, accountAdminController.reactivate);

  return router;
}

module.exports = createAuthRouter;
