/* create/remove are gone — employees are managed in modules/employees, not
   created or deleted from the Planner (migrations 028-030, tracker §4 item
   8). actorRole is passed through explicitly rather than the service
   reaching into req itself, matching this codebase's controller/service
   split (controllers do HTTP translation, services take plain arguments). */
function createTeamController({ teamService }) {
  function list(req, res, next) {
    try {
      return res.json({ team: teamService.list({ actorRole: req.user.role }) });
    } catch (err) {
      return next(err);
    }
  }

  function update(req, res, next) {
    try {
      const team = teamService.update({
        id: Number(req.params.id),
        patch: req.body || {},
        actorRole: req.user.role,
        actorId: req.user.id,
        actorEmail: req.user.email,
        ip: req.ip,
      });
      return res.json({ team });
    } catch (err) {
      return next(err);
    }
  }

  return { list, update };
}

module.exports = createTeamController;
