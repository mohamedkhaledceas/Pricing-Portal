const { EmployeesError } = require('../errors');

const VALID_LEAVE_TYPES = ['planned', 'short_notice', 'sick', 'emergency', 'mental_health', 'public_holiday', 'wfh', 'excuse', 'unpaid'];
const VALID_HALF_DAY_PERIODS = ['morning', 'afternoon'];

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/* Orchestrates the full Time_off.pdf §2 flow: submit -> validate/auto-reject
   -> manager decision -> P&C confirmation. timeOffRules holds the pure
   notice-window math; this service is what actually touches the DB and
   enforces who's allowed to do what. */
function createTimeOffService({ leaveRequestRepository, employeeRepository, leaveRequestModel, timeOffRules, audit, clickupLeaveSync, roles }) {
  async function submit({ employeeId, leaveType, startDate, endDate, halfDay, halfDayPeriod, handoverEmployeeId, reason, actorId, ip }) {
    if (!VALID_LEAVE_TYPES.includes(leaveType)) {
      throw new EmployeesError(`Leave type must be one of: ${VALID_LEAVE_TYPES.join(', ')}.`);
    }
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    if (!start || !end) {
      throw new EmployeesError('startDate and endDate must be valid dates in YYYY-MM-DD format.');
    }
    if (end < start) {
      throw new EmployeesError('End date cannot be before start date.');
    }
    if (halfDayPeriod && !VALID_HALF_DAY_PERIODS.includes(halfDayPeriod)) {
      throw new EmployeesError(`halfDayPeriod must be one of: ${VALID_HALF_DAY_PERIODS.join(', ')}.`);
    }
    if (handoverEmployeeId && !employeeRepository.findById(handoverEmployeeId)) {
      throw new EmployeesError('Handover teammate not found.');
    }

    let status = 'pending';
    let autoRejectReason = null;
    let salaryDeduction = 'none';

    /* WFH's own auto-reject condition (2nd request in the same calendar
       month) needs a DB query, so it's checked here rather than in the
       pure-function rules module — per Time_off.pdf... actually WFH isn't
       in the PDF at all; this quota is carried over from the old
       prototype's real, in-use behavior (see the migration plan's decision
       to keep WFH/Excuse/Unpaid alongside the 6 official types). */
    if (leaveType === 'wfh') {
      const yearMonth = startDate.slice(0, 7);
      const existingThisMonth = leaveRequestRepository.countWfhInMonth({ employeeId, yearMonth });
      if (existingThisMonth >= 1) {
        status = 'auto_rejected';
        autoRejectReason = `WFH quota for ${yearMonth} is already used. Only 1 WFH per month is allowed per policy.`;
      }
    }

    if (status === 'pending') {
      const submittedAt = new Date();
      const noticeCheck = timeOffRules.checkNoticeWindow({ leaveType, submittedAt, startDate: start });
      if (noticeCheck.autoReject) {
        status = 'auto_rejected';
        autoRejectReason = noticeCheck.reason;
        salaryDeduction = noticeCheck.salaryDeduction;
      }
    }

    const created = leaveRequestRepository.insert({
      employeeId,
      leaveType,
      startDate,
      endDate,
      halfDay,
      halfDayPeriod,
      handoverEmployeeId,
      reason,
      status,
      autoRejectReason,
      salaryDeduction,
    });

    audit.record({
      userId: actorId,
      action: status === 'auto_rejected' ? 'leave_request.auto_reject' : 'leave_request.submit',
      entityType: 'leave_request',
      entityId: String(created.id),
      details: { leaveType, startDate, endDate, status, autoRejectReason },
      ip,
    });

    const clickupTaskId = await clickupLeaveSync.createTask(leaveRequestModel.toLeaveRequest(created));
    if (clickupTaskId) leaveRequestRepository.setClickupTaskId(created.id, clickupTaskId);

    const requiresDoctorNote = leaveType === 'sick' && timeOffRules.sickLeaveRequiresDoctorNote({ startDate: start, endDate: end });
    return { ...leaveRequestModel.toLeaveRequest(created), requiresDoctorNote };
  }

  function listMine(employeeId) {
    return leaveRequestRepository.findByEmployeeId(employeeId).map(leaveRequestModel.toLeaveRequest);
  }

  function listTeam(managerEmployeeId) {
    const reportIds = employeeRepository.findByManagerId(managerEmployeeId).map((row) => row.id);
    return leaveRequestRepository.findByEmployeeIds(reportIds).map(leaveRequestModel.toLeaveRequest);
  }

  // Non-sensitive operational info — visible to any authenticated employee,
  // not gated on managing anyone. `date` is caller-supplied (YYYY-MM-DD)
  // rather than computed here, since "today" is a display concern the
  // frontend already resolves in the viewer's own locale.
  function listOffToday(date) {
    return leaveRequestRepository.findApprovedOverlapping(date).map((row) => ({
      employeeId: row.employee_id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      department: row.department,
      leaveType: row.leave_type,
      startDate: row.start_date,
      endDate: row.end_date,
      halfDay: row.half_day !== 0,
      halfDayPeriod: row.half_day_period,
    }));
  }

  function listPcPending({ actorAuthRole }) {
    if (actorAuthRole !== roles.PEOPLE_CULTURE) {
      throw new EmployeesError('You do not have permission to view the company-wide approval queue.', 403);
    }
    return leaveRequestRepository.findByStatus('manager_approved').map(leaveRequestModel.toLeaveRequest);
  }

  async function managerDecision({ requestId, actorEmployee, decision, actorId, ip }) {
    if (!['approved', 'rejected'].includes(decision)) {
      throw new EmployeesError('Decision must be "approved" or "rejected".');
    }
    const request = leaveRequestRepository.findById(requestId);
    if (!request) throw new EmployeesError('Leave request not found.', 404);
    if (request.status !== 'pending') {
      throw new EmployeesError('This request is no longer awaiting a manager decision.');
    }

    const employee = employeeRepository.findById(request.employee_id);
    if (!employee || !actorEmployee || employee.manager_employee_id !== actorEmployee.id) {
      throw new EmployeesError("You are not this employee's manager.", 403);
    }

    const newStatus = decision === 'approved' ? 'manager_approved' : 'rejected';
    const updated = leaveRequestRepository.updateManagerDecision(requestId, { status: newStatus, managerDecisionBy: actorEmployee.id });

    audit.record({
      userId: actorId,
      action: `leave_request.manager_${decision}`,
      entityType: 'leave_request',
      entityId: String(requestId),
      details: { before: { status: request.status }, after: { status: newStatus } },
      ip,
    });
    await clickupLeaveSync.updateStatus(request.clickup_task_id, newStatus);
    return leaveRequestModel.toLeaveRequest(updated);
  }

  /* P&C's confirmation step (Time_off.pdf §2/§3) — "validates against
     policy... sends final confirmation". salaryDeduction/unpaidDaysCount
     are P&C's own manual judgement call here (the breach table's
     non-automatic rows — everything except the same-day short-notice/
     mental-health case, which is already applied automatically at
     submission time and isn't meant to be overwritten by this step). */
  async function pcConfirm({ requestId, actorEmployee, actorAuthRole, decision, salaryDeduction, unpaidDaysCount, actorId, ip }) {
    if (!actorEmployee || actorAuthRole !== roles.PEOPLE_CULTURE) {
      throw new EmployeesError('You do not have permission to confirm leave requests.', 403);
    }
    if (!['approved', 'rejected'].includes(decision)) {
      throw new EmployeesError('Decision must be "approved" or "rejected".');
    }
    const request = leaveRequestRepository.findById(requestId);
    if (!request) throw new EmployeesError('Leave request not found.', 404);
    if (request.status !== 'manager_approved') {
      throw new EmployeesError('This request is not awaiting P&C confirmation.');
    }
    const deduction = salaryDeduction || request.salary_deduction || 'none';
    if (!['none', 'half_day', 'full_day', 'unpaid'].includes(deduction)) {
      throw new EmployeesError('salaryDeduction must be one of: none, half_day, full_day, unpaid.');
    }

    const updated = leaveRequestRepository.updatePcDecision(requestId, {
      status: decision,
      pcConfirmedBy: actorEmployee.id,
      salaryDeduction: deduction,
      unpaidDaysCount: deduction === 'unpaid' ? unpaidDaysCount || null : null,
    });

    audit.record({
      userId: actorId,
      action: `leave_request.pc_${decision}`,
      entityType: 'leave_request',
      entityId: String(requestId),
      details: { before: { status: request.status }, after: { status: decision, salaryDeduction: deduction } },
      ip,
    });
    await clickupLeaveSync.updateStatus(request.clickup_task_id, decision);
    return leaveRequestModel.toLeaveRequest(updated);
  }

  async function cancel({ requestId, actorEmployee, actorId, ip }) {
    const request = leaveRequestRepository.findById(requestId);
    if (!request) throw new EmployeesError('Leave request not found.', 404);
    if (!actorEmployee || request.employee_id !== actorEmployee.id) {
      throw new EmployeesError('You can only cancel your own requests.', 403);
    }
    if (!['pending', 'manager_approved'].includes(request.status)) {
      throw new EmployeesError('This request can no longer be cancelled.');
    }

    const updated = leaveRequestRepository.updateCancelled(requestId);
    audit.record({
      userId: actorId,
      action: 'leave_request.cancel',
      entityType: 'leave_request',
      entityId: String(requestId),
      details: { before: { status: request.status } },
      ip,
    });
    await clickupLeaveSync.updateStatus(request.clickup_task_id, 'cancelled');
    return leaveRequestModel.toLeaveRequest(updated);
  }

  return { submit, listMine, listTeam, listOffToday, listPcPending, managerDecision, pcConfirm, cancel };
}

module.exports = createTimeOffService;
