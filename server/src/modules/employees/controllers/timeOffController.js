const { EmployeesError } = require('../errors');

function requireEmployee(req) {
  if (!req.employee) {
    throw new EmployeesError('You need a completed employee profile before you can use Time Off. Contact People & Culture.', 403);
  }
  return req.employee;
}

// No local try/catch — EmployeesError extends the shared AppError, so a
// thrown error is auto-forwarded by Express to errorHandler.js, which
// already renders it correctly and now logs it with a correlation ID. The
// four async functions stay safe because routes/index.js wraps them in
// catchAsync, which forwards a rejected promise the same way.
function createTimeOffController({ timeOffService }) {
  async function submit(req, res) {
    const employee = requireEmployee(req);
    const body = req.body || {};
    const request = await timeOffService.submit({
      employeeId: employee.id,
      leaveType: body.leaveType,
      startDate: body.startDate,
      endDate: body.endDate,
      halfDay: !!body.halfDay,
      halfDayPeriod: body.halfDayPeriod,
      handoverEmployeeId: body.handoverEmployeeId,
      reason: body.reason,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.status(201).json({ request });
  }

  function listMine(req, res) {
    const employee = requireEmployee(req);
    return res.json({ requests: timeOffService.listMine(employee.id) });
  }

  // Manager role gets every request, company-wide, regardless of
  // manager_employee_id routing — see timeOffService.listTeam. Anyone else
  // with no employee profile of their own structurally can't have any
  // direct reports (manager_employee_id is a real employees.id FK), so "no
  // one reports to you" is the correct empty answer, not a 403 (same
  // leniency as rosterController.getDirectReports).
  function listTeam(req, res) {
    const requests = timeOffService.listTeam({ actorEmployee: req.employee, actorAuthRole: req.user.role });
    return res.json({ requests });
  }

  function offToday(req, res) {
    const date = req.query.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new EmployeesError('date query parameter (YYYY-MM-DD) is required.');
    }
    return res.json({ offToday: timeOffService.listOffToday(date) });
  }

  function listPcPending(req, res) {
    const requests = timeOffService.listPcPending({ actorAuthRole: req.user.role });
    return res.json({ requests });
  }

  function listAutoRejected(req, res) {
    const requests = timeOffService.listAutoRejected({ actorAuthRole: req.user.role });
    return res.json({ requests });
  }

  function getLeaveBreakdown(req, res) {
    const breakdown = timeOffService.getLeaveBreakdown({
      employeeId: Number(req.params.employeeId),
      actorAuthRole: req.user.role,
    });
    return res.json({ breakdown });
  }

  async function managerDecision(req, res) {
    const request = await timeOffService.managerDecision({
      requestId: Number(req.params.id),
      actorEmployee: req.employee,
      actorAuthRole: req.user.role,
      decision: (req.body || {}).decision,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ request });
  }

  async function pcConfirm(req, res) {
    const body = req.body || {};
    const request = await timeOffService.pcConfirm({
      requestId: Number(req.params.id),
      actorEmployee: req.employee,
      actorAuthRole: req.user.role,
      decision: body.decision,
      salaryDeduction: body.salaryDeduction,
      unpaidDaysCount: body.unpaidDaysCount,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ request });
  }

  async function cancel(req, res) {
    const request = await timeOffService.cancel({
      requestId: Number(req.params.id),
      actorEmployee: req.employee,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.json({ request });
  }

  return { submit, listMine, listTeam, offToday, listPcPending, listAutoRejected, getLeaveBreakdown, managerDecision, pcConfirm, cancel };
}

module.exports = createTimeOffController;
