const { EmployeesError } = require('../errors');

/* Data management only — see conflictPairService.js. */
function createConflictPairController({ conflictPairService }) {
  function handleError(res, error) {
    if (error instanceof EmployeesError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }

  function list(req, res) {
    try {
      const pairs = conflictPairService.list({ actorAuthRole: req.user.role, actorEmployee: req.employee });
      return res.json({ conflictPairs: pairs });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function create(req, res) {
    try {
      const body = req.body || {};
      const pair = conflictPairService.create({
        actorAuthRole: req.user.role,
        actorEmployee: req.employee,
        employeeIdA: body.employeeIdA,
        employeeIdB: body.employeeIdB,
      });
      return res.status(201).json({ conflictPair: pair });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function deactivate(req, res) {
    try {
      const pair = conflictPairService.setActive({
        actorAuthRole: req.user.role,
        actorEmployee: req.employee,
        id: Number(req.params.id),
        active: false,
      });
      return res.json({ conflictPair: pair });
    } catch (error) {
      return handleError(res, error);
    }
  }

  return { list, create, deactivate };
}

module.exports = createConflictPairController;
