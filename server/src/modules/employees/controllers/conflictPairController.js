/* Data management only — see conflictPairService.js. No local try/catch —
   EmployeesError extends the shared AppError, so a thrown error is
   auto-forwarded by Express to errorHandler.js, which already renders it
   correctly and now logs it with a correlation ID. */
function createConflictPairController({ conflictPairService }) {
  function list(req, res) {
    const pairs = conflictPairService.list({ actorAuthRole: req.user.role, actorEmployee: req.employee });
    return res.json({ conflictPairs: pairs });
  }

  function create(req, res) {
    const body = req.body || {};
    const pair = conflictPairService.create({
      actorAuthRole: req.user.role,
      actorEmployee: req.employee,
      employeeIdA: body.employeeIdA,
      employeeIdB: body.employeeIdB,
    });
    return res.status(201).json({ conflictPair: pair });
  }

  function deactivate(req, res) {
    const pair = conflictPairService.setActive({
      actorAuthRole: req.user.role,
      actorEmployee: req.employee,
      id: Number(req.params.id),
      active: false,
    });
    return res.json({ conflictPair: pair });
  }

  return { list, create, deactivate };
}

module.exports = createConflictPairController;
