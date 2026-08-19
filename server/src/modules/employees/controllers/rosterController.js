const { EmployeesError } = require('../errors');

function createRosterController({ rosterService }) {
  function handleError(res, error) {
    if (error instanceof EmployeesError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }

  function list(req, res) {
    try {
      const employees = rosterService.listAll({ actorAuthRole: req.user.role, actorEmployee: req.employee });
      return res.json({ employees });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function getMine(req, res) {
    return res.json({ employee: req.employee });
  }

  function directory(req, res) {
    return res.json({ employees: rosterService.listDirectory() });
  }

  function getDirectReports(req, res) {
    if (!req.employee) {
      return res.json({ employees: [] });
    }
    const employees = rosterService.getDirectReports(req.employee.id);
    return res.json({ employees });
  }

  function create(req, res) {
    try {
      const body = req.body || {};
      const employee = rosterService.create({
        actorAuthRole: req.user.role,
        actorEmployee: req.employee,
        userId: body.userId,
        clickupUserId: body.clickupUserId,
        department: body.department,
        kpiProfile: body.kpiProfile,
        managerEmployeeId: body.managerEmployeeId,
        isPeopleCulture: body.isPeopleCulture,
        actorId: req.user.id,
        ip: req.ip,
      });
      return res.status(201).json({ employee });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function update(req, res) {
    try {
      const body = req.body || {};
      const employee = rosterService.update({
        actorAuthRole: req.user.role,
        actorEmployee: req.employee,
        targetId: Number(req.params.id),
        clickupUserId: body.clickupUserId,
        department: body.department,
        kpiProfile: body.kpiProfile,
        managerEmployeeId: body.managerEmployeeId,
        isPeopleCulture: body.isPeopleCulture,
        actorId: req.user.id,
        ip: req.ip,
      });
      return res.json({ employee });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function deactivate(req, res) {
    try {
      const employee = rosterService.setActive({
        actorAuthRole: req.user.role,
        actorEmployee: req.employee,
        targetId: Number(req.params.id),
        active: false,
        actorId: req.user.id,
        ip: req.ip,
      });
      return res.json({ employee });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function reactivate(req, res) {
    try {
      const employee = rosterService.setActive({
        actorAuthRole: req.user.role,
        actorEmployee: req.employee,
        targetId: Number(req.params.id),
        active: true,
        actorId: req.user.id,
        ip: req.ip,
      });
      return res.json({ employee });
    } catch (error) {
      return handleError(res, error);
    }
  }

  return { list, getMine, directory, getDirectReports, create, update, deactivate, reactivate };
}

module.exports = createRosterController;
