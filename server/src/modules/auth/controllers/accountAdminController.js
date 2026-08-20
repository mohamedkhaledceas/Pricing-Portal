/* No local try/catch — AuthError extends the shared AppError, so a thrown
   error is auto-forwarded by Express to errorHandler.js, which already
   knows how to render it and now logs it with a correlation ID. */
function createAccountAdminController({ accountAdminService, transaction }) {
  function listUsers(req, res) {
    const users = accountAdminService.listUsers({ actorRole: req.user.role });
    return res.json({ users });
  }

  function changeRole(req, res) {
    const user = accountAdminService.changeRole({
      actorId: req.user.id,
      actorRole: req.user.role,
      targetId: Number(req.params.id),
      role: req.body ? req.body.role : undefined,
      ip: req.ip,
    });
    return res.json({ user });
  }

  function deactivate(req, res) {
    const user = accountAdminService.deactivate({
      actorId: req.user.id,
      actorRole: req.user.role,
      targetId: Number(req.params.id),
      ip: req.ip,
      transaction,
    });
    return res.json({ user });
  }

  function reactivate(req, res) {
    const user = accountAdminService.reactivate({
      actorId: req.user.id,
      actorRole: req.user.role,
      targetId: Number(req.params.id),
      ip: req.ip,
    });
    return res.json({ user });
  }

  return { listUsers, changeRole, deactivate, reactivate };
}

module.exports = createAccountAdminController;
