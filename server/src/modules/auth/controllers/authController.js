const { AuthError } = require('../errors');

/* Thin HTTP translation only — every actual rule lives in authService.
   transaction is injected only because authService.changePassword needs it
   (see repositories/unitOfWork.js); no other handler here uses it.

   No local try/catch-and-respond here (beyond refresh's cookie side effect
   below) — AuthError now extends the shared AppError, so a synchronous
   throw is auto-forwarded by Express straight to errorHandler.js, which
   already knows how to turn an AppError into the same `{error: message}`
   shape this used to build by hand. The difference: it's actually logged
   now, with a correlation ID, instead of vanishing on the way out. */
function createAuthController({ authService, setRefreshCookie, clearRefreshCookie, readRefreshCookie, transaction }) {
  function register(req, res) {
    const { token, user, refreshToken } = authService.register({ ...req.body, ip: req.ip });
    setRefreshCookie(res, refreshToken);
    return res.status(201).json({ token, user });
  }

  function login(req, res) {
    const { token, user, refreshToken } = authService.login({ ...req.body, ip: req.ip });
    setRefreshCookie(res, refreshToken);
    return res.json({ token, user });
  }

  // Still needs its own try/catch — clearing the refresh cookie on a failed
  // refresh is a real side effect worth keeping, not just response-building.
  function refresh(req, res, next) {
    try {
      const { token, user, refreshToken } = authService.refresh({ rawToken: readRefreshCookie(req) });
      setRefreshCookie(res, refreshToken);
      return res.json({ token, user });
    } catch (error) {
      if (error instanceof AuthError) clearRefreshCookie(res);
      return next(error);
    }
  }

  function logout(req, res) {
    authService.logout({ rawToken: readRefreshCookie(req), ip: req.ip });
    clearRefreshCookie(res);
    return res.json({ ok: true });
  }

  function getMe(req, res) {
    const user = authService.getMe(req.user.id);
    return res.json({ user });
  }

  function updateProfile(req, res) {
    const user = authService.updateProfile({ userId: req.user.id, ...req.body });
    return res.json({ user });
  }

  function changePassword(req, res) {
    authService.changePassword({ userId: req.user.id, ...req.body, transaction });
    return res.json({ ok: true });
  }

  return { register, login, refresh, logout, getMe, updateProfile, changePassword };
}

module.exports = createAuthController;
