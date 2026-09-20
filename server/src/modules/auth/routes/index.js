const express = require('express');
const rateLimit = require('express-rate-limit');
const catchAsync = require('../../../common/catchAsync');

/* Mounted at /api in index.js, so these paths resolve exactly as they do
   today: /api/auth/register, /api/auth/login, /api/auth/refresh,
   /api/auth/logout, /api/me, /api/me/profile, /api/me/password, /api/users,
   /api/users/export, /api/users/:id/role, /api/users/:id/deactivate,
   /api/users/:id/reactivate — unchanged (plus the new export route), so
   margin-planner_1.html and commercial-lead.html keep working without any
   frontend change. */
function createAuthRouter({ authController, accountAdminController, authenticate }) {
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a minute and try again.' },
  });

  // Tighter and separate from authLimiter above — unlike login/register,
  // this endpoint triggers a real outbound email on every call, so it's a
  // spam/cost vector (someone hammering it to flood a target's inbox) as
  // well as an abuse-of-credentials one. IP-keyed only, same as
  // authLimiter — a per-email limit would need its own state beyond what
  // express-rate-limit's default store gives us, not worth adding for a
  // 21-person internal tool; revisit if that ever proves insufficient.
  const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a while and try again.' },
  });

  const router = express.Router();

  router.post('/auth/register', authLimiter, authController.register);
  router.post('/auth/login', authLimiter, authController.login);
  router.post('/auth/refresh', authLimiter, authController.refresh);
  router.post('/auth/logout', authController.logout);
  router.post('/auth/forgot-password', forgotPasswordLimiter, catchAsync(authController.forgotPassword));
  router.post('/auth/reset-password', authLimiter, authController.resetPassword);

  router.get('/me', authenticate, authController.getMe);
  router.patch('/me/profile', authenticate, authController.updateProfile);
  router.patch('/me/password', authenticate, authController.changePassword);

  router.get('/users', authenticate, accountAdminController.listUsers);
  router.get('/users/export', authenticate, accountAdminController.exportUsers);
  router.patch('/users/:id/role', authenticate, accountAdminController.changeRole);
  router.post('/users/:id/deactivate', authenticate, accountAdminController.deactivate);
  router.post('/users/:id/reactivate', authenticate, accountAdminController.reactivate);

  return router;
}

module.exports = createAuthRouter;
