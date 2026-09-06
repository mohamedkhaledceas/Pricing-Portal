const { EmployeesError } = require('../errors');

/* Data management + self-serve warning checks — see conflictPairService.js.
   No local try/catch — EmployeesError extends the shared AppError, so a
   thrown error is auto-forwarded by Express to errorHandler.js, which
   already renders it correctly and now logs it with a correlation ID. */
function createConflictPairController({ conflictPairService }) {
  function mine(req, res) {
    return res.json({ partners: conflictPairService.getMyPartners(req.employee) });
  }

  function mineOverlap(req, res) {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      throw new EmployeesError('startDate and endDate query parameters are required.');
    }
    if (!req.employee) return res.json({ conflicts: [] });
    return res.json({ conflicts: conflictPairService.findOverlaps({ employeeId: req.employee.id, startDate, endDate }) });
  }

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
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.status(201).json({ conflictPair: pair });
  }

  function update(req, res) {
    const body = req.body || {};
    const pair = conflictPairService.update({
      actorAuthRole: req.user.role,
      id: Number(req.params.id),
      employeeIdA: body.employeeIdA,
      employeeIdB: body.employeeIdB,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ conflictPair: pair });
  }

  function remove(req, res) {
    conflictPairService.remove({
      actorAuthRole: req.user.role,
      id: Number(req.params.id),
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.status(204).send();
  }

  return { mine, mineOverlap, list, create, update, remove };
}

module.exports = createConflictPairController;
