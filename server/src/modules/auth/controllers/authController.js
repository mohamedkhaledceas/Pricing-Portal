const { AuthError } = require('../errors');

/* Thin HTTP translation only — every actual rule lives in authService.
   transaction is injected only because authService.changePassword needs it
   (see repositories/unitOfWork.js); no other handler here uses it. */
function createAuthController({ authService, setRefreshCookie, clearRefreshCookie, readRefreshCookie, transaction }) {
  function handleAuthError(res, error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }

  function register(req, res) {
    try {
      const { token, user, refreshToken } = authService.register({ ...req.body, ip: req.ip });
      setRefreshCookie(res, refreshToken);
      return res.status(201).json({ token, user });
    } catch (error) {
      return handleAuthError(res, error);
    }
  }

  function login(req, res) {
    try {
      const { token, user, refreshToken } = authService.login({ ...req.body, ip: req.ip });
      setRefreshCookie(res, refreshToken);
      return res.json({ token, user });
    } catch (error) {
      return handleAuthError(res, error);
    }
  }

  function refresh(req, res) {
    try {
      const { token, user, refreshToken } = authService.refresh({ rawToken: readRefreshCookie(req) });
      setRefreshCookie(res, refreshToken);
      return res.json({ token, user });
    } catch (error) {
      if (error instanceof AuthError) {
        clearRefreshCookie(res);
        return res.status(error.status).json({ error: error.message });
      }
      throw error;
    }
  }

  function logout(req, res) {
    authService.logout({ rawToken: readRefreshCookie(req), ip: req.ip });
    clearRefreshCookie(res);
    return res.json({ ok: true });
  }

  function getMe(req, res) {
    try {
      const user = authService.getMe(req.user.id);
      return res.json({ user });
    } catch (error) {
      return handleAuthError(res, error);
    }
  }

  function updateProfile(req, res) {
    try {
      const user = authService.updateProfile({ userId: req.user.id, ...req.body });
      return res.json({ user });
    } catch (error) {
      return handleAuthError(res, error);
    }
  }

  function changePassword(req, res) {
    try {
      authService.changePassword({ userId: req.user.id, ...req.body, transaction });
      return res.json({ ok: true });
    } catch (error) {
      return handleAuthError(res, error);
    }
  }

  return { register, login, refresh, logout, getMe, updateProfile, changePassword };
}

module.exports = createAuthController;
