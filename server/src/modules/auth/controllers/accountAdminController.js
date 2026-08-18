const { AuthError } = require('../errors');

function createAccountAdminController({ accountAdminService, transaction }) {
  function handleError(res, error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }

  function listUsers(req, res) {
    try {
      const users = accountAdminService.listUsers({ actorRole: req.user.role });
      return res.json({ users });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function changeRole(req, res) {
    try {
      const user = accountAdminService.changeRole({
        actorId: req.user.id,
        actorRole: req.user.role,
        targetId: Number(req.params.id),
        role: req.body ? req.body.role : undefined,
        ip: req.ip,
      });
      return res.json({ user });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function deactivate(req, res) {
    try {
      const user = accountAdminService.deactivate({
        actorId: req.user.id,
        actorRole: req.user.role,
        targetId: Number(req.params.id),
        ip: req.ip,
        transaction,
      });
      return res.json({ user });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function reactivate(req, res) {
    try {
      const user = accountAdminService.reactivate({
        actorId: req.user.id,
        actorRole: req.user.role,
        targetId: Number(req.params.id),
        ip: req.ip,
      });
      return res.json({ user });
    } catch (error) {
      return handleError(res, error);
    }
  }

  return { listUsers, changeRole, deactivate, reactivate };
}

module.exports = createAccountAdminController;
