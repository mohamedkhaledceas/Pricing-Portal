const { EmployeesError } = require('../errors');

/* No local try/catch — EmployeesError extends the shared AppError, so a
   thrown error is auto-forwarded by Express to errorHandler.js, which
   already renders it correctly and now logs it with a correlation ID. */
function createRosterController({ rosterService }) {
  function list(req, res) {
    const employees = rosterService.listAll({ actorAuthRole: req.user.role, actorEmployee: req.employee });
    return res.json({ employees });
  }

  function getMine(req, res) {
    // req.employee (from attachEmployee) is undecorated — fine for the
    // permission checks it's normally used for, but Account Settings needs
    // the real computed on_leave status, so this refetches through
    // rosterService.getMine instead (see decorateStatusOne there).
    const pendingChangeRequest = rosterService.getMyPendingChangeRequest(req.employee);
    const employee = req.employee ? rosterService.getMine(req.user.id) : null;
    return res.json({ employee, pendingChangeRequest });
  }

  function directory(req, res) {
    return res.json({ employees: rosterService.listDirectory() });
  }

  // Pre-auth (see routes/index.js — mounted before the authenticate gate) —
  // powers the signup wizard's Assigned Manager dropdown, filtered to the
  // department the person is currently choosing.
  function teamHeadsPublic(req, res) {
    const department = typeof req.query.department === 'string' ? req.query.department : '';
    return res.json({ employees: rosterService.listTeamHeadsByDepartment(department) });
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
      jobTitle: body.jobTitle,
      employmentType: body.employmentType,
      joiningDate: body.joiningDate,
      workLocation: body.workLocation,
      status: body.status,
      isTeamHead: body.isTeamHead,
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
      jobTitle: body.jobTitle,
      employmentType: body.employmentType,
      joiningDate: body.joiningDate,
      workLocation: body.workLocation,
      status: body.status,
      isTeamHead: body.isTeamHead,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ employee });
  }

  function uploadMyPhoto(req, res) {
    if (!req.file) throw new EmployeesError('A photo file is required.');
    const photoUrl = `/uploads/employees/${req.file.filename}`;
    const employee = rosterService.setMyPhoto({
      actorEmployee: req.employee,
      photoUrl,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ employee });
  }

  function removeMyPhoto(req, res) {
    const employee = rosterService.setMyPhoto({
      actorEmployee: req.employee,
      photoUrl: null,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ employee });
  }

  function updateMine(req, res) {
    const body = req.body || {};
    const result = rosterService.updateMine({
      actorEmployee: req.employee,
      department: body.department,
      jobTitle: body.jobTitle,
      employmentType: body.employmentType,
      joiningDate: body.joiningDate,
      workLocation: body.workLocation,
      managerEmployeeId: body.managerEmployeeId,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json(result);
  }

  function pendingChangeRequests(req, res) {
    const requests = rosterService.listPendingChangeRequests({ actorAuthRole: req.user.role });
    return res.json({ requests });
  }

  function approveChangeRequest(req, res) {
    const employee = rosterService.approveChangeRequest({
      actorAuthRole: req.user.role,
      requestId: Number(req.params.id),
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ employee });
  }

  function rejectChangeRequest(req, res) {
    rosterService.rejectChangeRequest({
      actorAuthRole: req.user.role,
      requestId: Number(req.params.id),
      decisionNote: (req.body || {}).decisionNote,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ ok: true });
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

  return {
    list, getMine, directory, teamHeadsPublic, getDirectReports, create, update, deactivate, reactivate,
    uploadMyPhoto, removeMyPhoto, updateMine,
    pendingChangeRequests, approveChangeRequest, rejectChangeRequest,
  };
}

module.exports = createRosterController;
