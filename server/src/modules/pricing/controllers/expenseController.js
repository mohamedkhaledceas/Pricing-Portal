function createExpenseController({ expenseService }) {
  function list(req, res, next) {
    try {
      return res.json({ expenses: expenseService.list() });
    } catch (err) {
      return next(err);
    }
  }

  function create(req, res, next) {
    try {
      const expenses = expenseService.create({ data: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.status(201).json({ expenses });
    } catch (err) {
      return next(err);
    }
  }

  function update(req, res, next) {
    try {
      const expenses = expenseService.update({ id: req.params.id, patch: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ expenses });
    } catch (err) {
      return next(err);
    }
  }

  function remove(req, res, next) {
    try {
      const expenses = expenseService.remove({ id: req.params.id, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ expenses });
    } catch (err) {
      return next(err);
    }
  }

  return { list, create, update, remove };
}

module.exports = createExpenseController;
