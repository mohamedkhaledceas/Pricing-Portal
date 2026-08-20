/* No local try/catch — EmployeesError extends the shared AppError, so a
   thrown error is auto-forwarded by Express to errorHandler.js, which
   already renders it correctly and now logs it with a correlation ID. */
function createRosterController({ rosterService }) {
  function list(req, res) {
    const employees = rosterService.listAll({ actorAuthRole: req.user.role, actorEmployee: req.employee });
    return res.json({ employees });
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
    const body = req.body || {};
    const employee = rosterService.create({
      actorAuthRole: req.user.role,
      actorEmployee: req.employee,
      userId: body.userId,
      clickupUserId: body.clickupUserId,
      department: body.department,
      kpiProfile: body.kpiProfile,
      managerEmployeeId: body.managerEmployeeId,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.status(201).json({ employee });
  }

  function update(req, res) {
    const body = req.body || {};
    const employee = rosterService.update({
      actorAuthRole: req.user.role,
      actorEmployee: req.employee,
      targetId: Number(req.params.id),
      clickupUserId: body.clickupUserId,
      department: body.department,
      kpiProfile: body.kpiProfile,
      managerEmployeeId: body.managerEmployeeId,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ employee });
  }

  function deactivate(req, res) {
    const employee = rosterService.setActive({
      actorAuthRole: req.user.role,
      actorEmployee: req.employee,
      targetId: Number(req.params.id),
      active: false,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ employee });
  }

  function reactivate(req, res) {
    const employee = rosterService.setActive({
      actorAuthRole: req.user.role,
      actorEmployee: req.employee,
      targetId: Number(req.params.id),
      active: true,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ employee });
  }

  return { list, getMine, directory, getDirectReports, create, update, deactivate, reactivate };
}

module.exports = createRosterController;
