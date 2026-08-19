/* Runs after auth's authenticate middleware (which sets req.user). Looks up
   the caller's own employee record once per request and attaches it as
   req.employee — every employees-domain route needs this (roster
   permission checks, "am I this leave request's manager", KPI visibility
   scoping). req.employee is null, not an error, for an account that has no
   employee record yet — signing up and being onboarded as an employee are
   deliberately separate steps (see rosterService). */
function createAttachEmployeeMiddleware({ employeeRepository, employeeModel }) {
  return function attachEmployee(req, res, next) {
    const row = employeeRepository.findByUserId(req.user.id);
    req.employee = employeeModel.toEmployee(row);
    next();
  };
}

module.exports = createAttachEmployeeMiddleware;
