/* Data management for the departments list — see departmentService.js.
   Unlike this module's other controllers (which rely on Express 4's
   auto-forwarding of a synchronous throw to errorHandler.js), each handler
   here explicitly try/catches and calls next(err) — same downstream
   handling (EmployeesError still renders via errorHandler.js's existing
   `err instanceof AppError` branch), just made explicit rather than
   implicit for this controller. */
function createDepartmentController({ departmentService }) {
  function list(req, res, next) {
    try {
      const departments = departmentService.list();
      return res.json({ departments });
    } catch (err) {
      return next(err);
    }
  }

  function create(req, res, next) {
    try {
      const department = departmentService.create({
        actorAuthRole: req.user.role,
        label: (req.body || {}).label,
        actorId: req.user.id,
        ip: req.ip,
      });
      return res.status(201).json({ department });
    } catch (err) {
      return next(err);
    }
  }

  function update(req, res, next) {
    try {
      const department = departmentService.update({
        actorAuthRole: req.user.role,
        id: Number(req.params.id),
        label: (req.body || {}).label,
        actorId: req.user.id,
        ip: req.ip,
      });
      return res.json({ department });
    } catch (err) {
      return next(err);
    }
  }

  return { list, create, update };
}

module.exports = createDepartmentController;
