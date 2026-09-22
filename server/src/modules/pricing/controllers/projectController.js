function createProjectController({ projectService }) {
  function list(req, res, next) {
    try {
      return res.json({ projects: projectService.list() });
    } catch (err) {
      return next(err);
    }
  }

  function create(req, res, next) {
    try {
      const project = projectService.create({ data: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.status(201).json({ project });
    } catch (err) {
      return next(err);
    }
  }

  function update(req, res, next) {
    try {
      const project = projectService.update({ id: req.params.id, patch: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ project });
    } catch (err) {
      return next(err);
    }
  }

  function remove(req, res, next) {
    try {
      const projects = projectService.remove({ id: req.params.id, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ projects });
    } catch (err) {
      return next(err);
    }
  }

  function history(req, res, next) {
    try {
      return res.json({ history: projectService.getHistory(req.params.id) });
    } catch (err) {
      return next(err);
    }
  }

  // Response key quirks below (line/direct/scenario singular on create+
  // update, but the plural-list key differs per resource on delete) match
  // the legacy routes' own contract exactly — the frontend depends on them.

  function createLine(req, res, next) {
    try {
      const line = projectService.createLine({ projectId: req.params.projectId, data: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.status(201).json({ line });
    } catch (err) {
      return next(err);
    }
  }

  function updateLine(req, res, next) {
    try {
      const line = projectService.updateLine({ projectId: req.params.projectId, id: req.params.id, patch: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ line });
    } catch (err) {
      return next(err);
    }
  }

  function removeLine(req, res, next) {
    try {
      const lines = projectService.removeLine({ projectId: req.params.projectId, id: req.params.id, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ lines });
    } catch (err) {
      return next(err);
    }
  }

  function createDirectCost(req, res, next) {
    try {
      const direct = projectService.createDirectCost({ projectId: req.params.projectId, data: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.status(201).json({ direct });
    } catch (err) {
      return next(err);
    }
  }

  function updateDirectCost(req, res, next) {
    try {
      const direct = projectService.updateDirectCost({ projectId: req.params.projectId, id: req.params.id, patch: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ direct });
    } catch (err) {
      return next(err);
    }
  }

  function removeDirectCost(req, res, next) {
    try {
      const direct = projectService.removeDirectCost({ projectId: req.params.projectId, id: req.params.id, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ direct });
    } catch (err) {
      return next(err);
    }
  }

  function createScenario(req, res, next) {
    try {
      const scenario = projectService.createScenario({ projectId: req.params.projectId, data: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.status(201).json({ scenario });
    } catch (err) {
      return next(err);
    }
  }

  function updateScenario(req, res, next) {
    try {
      const scenario = projectService.updateScenario({ projectId: req.params.projectId, id: req.params.id, patch: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ scenario });
    } catch (err) {
      return next(err);
    }
  }

  function removeScenario(req, res, next) {
    try {
      const scenarios = projectService.removeScenario({ projectId: req.params.projectId, id: req.params.id, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ scenarios });
    } catch (err) {
      return next(err);
    }
  }

  function createQuoteLine(req, res, next) {
    try {
      const line = projectService.createQuoteLine({ projectId: req.params.projectId, data: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.status(201).json({ line });
    } catch (err) {
      return next(err);
    }
  }

  function updateQuoteLine(req, res, next) {
    try {
      const line = projectService.updateQuoteLine({ projectId: req.params.projectId, id: req.params.id, patch: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ line });
    } catch (err) {
      return next(err);
    }
  }

  function removeQuoteLine(req, res, next) {
    try {
      const lines = projectService.removeQuoteLine({ projectId: req.params.projectId, id: req.params.id, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ lines });
    } catch (err) {
      return next(err);
    }
  }

  return {
    list, create, update, remove, history,
    createLine, updateLine, removeLine,
    createDirectCost, updateDirectCost, removeDirectCost,
    createScenario, updateScenario, removeScenario,
    createQuoteLine, updateQuoteLine, removeQuoteLine,
  };
}

module.exports = createProjectController;
