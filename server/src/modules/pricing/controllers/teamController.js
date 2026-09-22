function createTeamController({ teamService }) {
  function list(req, res, next) {
    try {
      return res.json({ team: teamService.list() });
    } catch (err) {
      return next(err);
    }
  }

  function create(req, res, next) {
    try {
      const team = teamService.create({ data: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.status(201).json({ team });
    } catch (err) {
      return next(err);
    }
  }

  function update(req, res, next) {
    try {
      const team = teamService.update({ id: req.params.id, patch: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ team });
    } catch (err) {
      return next(err);
    }
  }

  function remove(req, res, next) {
    try {
      const team = teamService.remove({ id: req.params.id, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ team });
    } catch (err) {
      return next(err);
    }
  }

  return { list, create, update, remove };
}

module.exports = createTeamController;
