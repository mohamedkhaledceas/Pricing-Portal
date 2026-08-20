const { EmployeesError } = require('../errors');

function requireEmployee(req) {
  if (!req.employee) {
    throw new EmployeesError('You need a completed employee profile before you can use Time Off. Contact People & Culture.', 403);
  }
  return req.employee;
}

function createTimeOffController({ timeOffService }) {
  function handleError(res, error) {
    if (error instanceof EmployeesError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }

  async function submit(req, res) {
    try {
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
    } catch (error) {
      return handleError(res, error);
    }
  }

  function listMine(req, res) {
    try {
      const employee = requireEmployee(req);
      return res.json({ requests: timeOffService.listMine(employee.id) });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function listTeam(req, res) {
    try {
      // Manager role gets every request, company-wide, regardless of
      // manager_employee_id routing — see timeOffService.listTeam. Anyone
      // else with no employee profile of their own structurally can't have
      // any direct reports (manager_employee_id is a real employees.id
      // FK), so "no one reports to you" is the correct empty answer, not a
      // 403 (same leniency as rosterController.getDirectReports).
      const requests = timeOffService.listTeam({ actorEmployee: req.employee, actorAuthRole: req.user.role });
      return res.json({ requests });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function offToday(req, res) {
    try {
      const date = req.query.date;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new EmployeesError('date query parameter (YYYY-MM-DD) is required.');
      }
      return res.json({ offToday: timeOffService.listOffToday(date) });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function listPcPending(req, res) {
    try {
      const requests = timeOffService.listPcPending({ actorAuthRole: req.user.role });
      return res.json({ requests });
    } catch (error) {
      return handleError(res, error);
    }
  }

  function listAutoRejected(req, res) {
    try {
      const requests = timeOffService.listAutoRejected({ actorAuthRole: req.user.role });
      return res.json({ requests });
    } catch (error) {
      return handleError(res, error);
    }
  }

  async function managerDecision(req, res) {
    try {
      const request = await timeOffService.managerDecision({
        requestId: Number(req.params.id),
        actorEmployee: req.employee,
        actorAuthRole: req.user.role,
        decision: (req.body || {}).decision,
        actorId: req.user.id,
        ip: req.ip,
      });
      return res.json({ request });
    } catch (error) {
      return handleError(res, error);
    }
  }

  async function pcConfirm(req, res) {
    try {
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
    } catch (error) {
      return handleError(res, error);
    }
  }

  async function cancel(req, res) {
    try {
      const request = await timeOffService.cancel({
        requestId: Number(req.params.id),
        actorEmployee: req.employee,
        actorId: req.user.id,
        ip: req.ip,
      });
      return res.json({ request });
    } catch (error) {
      return handleError(res, error);
    }
  }

  return { submit, listMine, listTeam, offToday, listPcPending, listAutoRejected, managerDecision, pcConfirm, cancel };
}

module.exports = createTimeOffController;
