/* The service is synchronous (better-sqlite3 reads), but the handler still
   forwards errors explicitly rather than relying on Express 4 catching a
   synchronous throw — deliberate, per the project's preference for
   explicit error paths in new controllers. */
function createCeoDashboardController({
  controlRoomService, clientBookService, budgetService, targetService, escalationService,
}) {
  const actorOf = (req) => ({ id: req.user.id, role: req.user.role });

  function controlRoom(req, res, next) {
    try {
      const entity = req.query.entity || 'ceas';
      res.json({ controlRoom: controlRoomService.getControlRoom(String(entity)) });
    } catch (err) {
      next(err);
    }
  }

  function budget(req, res, next) {
    try {
      res.json({ controlRoom: controlRoomService.getBudget() });
    } catch (err) {
      next(err);
    }
  }

  function clients(req, res, next) {
    try {
      res.json({ clients: clientBookService.listClients(req.query) });
    } catch (err) {
      next(err);
    }
  }

  // Async: the detail fetches the client's ClickUp tasks live.
  async function clientDetail(req, res, next) {
    try {
      res.json({ client: await clientBookService.getClientDetail(req.params.key) });
    } catch (err) {
      next(err);
    }
  }

  function updateBudgetLine(req, res, next) {
    try {
      const { annual, note } = req.body || {};
      res.json({ budgetLine: budgetService.updateLine({ actor: actorOf(req), name: req.params.name, annual, note, ip: req.ip }) });
    } catch (err) {
      next(err);
    }
  }

  function updateFunctionPlan(req, res, next) {
    try {
      const { functionId, category, month, amount, note } = req.body || {};
      res.json({ plan: budgetService.updatePlan({ actor: actorOf(req), functionId, category, month, amount, note, ip: req.ip }) });
    } catch (err) {
      next(err);
    }
  }

  function updateTarget(req, res, next) {
    try {
      const { entity, kpiId, target, note } = req.body || {};
      res.json({ target: targetService.setTarget({ actor: actorOf(req), entity, kpiId, target, note, ip: req.ip }) });
    } catch (err) {
      next(err);
    }
  }

  function addKpi(req, res, next) {
    try {
      const { entity, name, unit, direction, targetType, component, actual, target } = req.body || {};
      res.status(201).json({
        kpi: targetService.addCustomKpi({ actor: actorOf(req), entity, name, unit, direction, targetType, component, actual, target, ip: req.ip }),
      });
    } catch (err) {
      next(err);
    }
  }

  function archiveKpi(req, res, next) {
    try {
      const { entity } = req.body || {};
      res.json({ kpi: targetService.archiveCustomKpi({ actor: actorOf(req), entity, kpiId: req.params.kpiId, ip: req.ip }) });
    } catch (err) {
      next(err);
    }
  }

  function updateEscalationRoute(req, res, next) {
    try {
      const { comesToCeo } = req.body || {};
      res.json({ prefs: escalationService.setRoute({ actor: actorOf(req), area: req.params.area, comesToCeo, ip: req.ip }) });
    } catch (err) {
      next(err);
    }
  }

  function updateEscalationThreshold(req, res, next) {
    try {
      const { amount } = req.body || {};
      res.json({ prefs: escalationService.setThreshold({ actor: actorOf(req), amount, ip: req.ip }) });
    } catch (err) {
      next(err);
    }
  }

  return {
    controlRoom, budget, clients, clientDetail, updateBudgetLine, updateFunctionPlan, updateTarget, addKpi, archiveKpi,
    updateEscalationRoute, updateEscalationThreshold,
  };
}

module.exports = createCeoDashboardController;
