const { EmployeesError } = require('../errors');

const VALID_LEAVE_TYPES = ['planned', 'short_notice', 'sick', 'emergency', 'mental_health', 'public_holiday', 'wfh', 'excuse', 'unpaid'];
const VALID_AVAILABILITY = ['full_day', 'partial_day', 'unavailable'];

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/* Orchestrates the full Time_off.pdf §2 flow: submit -> validate/auto-reject
   -> manager decision -> P&C confirmation. timeOffRules holds the pure
   notice-window math; this service is what actually touches the DB and
   enforces who's allowed to do what. */
function createTimeOffService({ leaveRequestRepository, employeeRepository, leaveRequestModel, timeOffRules, leaveBalanceRules, audit, clickupLeaveSync, conflictPairService, roles }) {
  async function submit({ employeeId, leaveType, startDate, endDate, availability, handoverEmployeeId, reason, actorId, ip }) {
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
    // WFH's form hides the Availability field (same carve-out half_day used
    // to have) — the request is inherently "working, just from home".
    if (leaveType !== 'wfh' && !VALID_AVAILABILITY.includes(availability)) {
      throw new EmployeesError(`availability must be one of: ${VALID_AVAILABILITY.join(', ')}.`);
    }
    if (!reason || !reason.trim()) {
      throw new EmployeesError('A reason is required.');
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

    // An employee with no manager_employee_id has nobody who could ever
    // pass managerDecision's exact-match check (see that function's own
    // comment — there's deliberately no auth-role bypass there), so a
    // request that stayed 'pending' would sit unactionable forever. Route
    // it straight to the P&C queue instead: skip the manager stage the
    // same way an already-manager_approved request would land there.
    const requestingEmployee = employeeRepository.findById(employeeId);
    const skippedManagerStage = status === 'pending' && !(requestingEmployee && requestingEmployee.manager_employee_id);
    if (skippedManagerStage) {
      status = 'manager_approved';
    }

    let created = leaveRequestRepository.insert({
      employeeId,
      leaveType,
      startDate,
      endDate,
      availability: leaveType === 'wfh' ? null : availability,
      handoverEmployeeId,
      reason,
      status,
      autoRejectReason,
      salaryDeduction,
    });

    if (skippedManagerStage) {
      created = leaveRequestRepository.updateManagerDecision(created.id, {
        status: 'manager_approved',
        managerDecisionBy: null,
        decisionNote: 'No manager assigned — routed directly to People & Culture for review.',
      });
    }

    audit.record({
      userId: actorId,
      action: skippedManagerStage
        ? 'leave_request.auto_route_no_manager'
        : status === 'auto_rejected'
          ? 'leave_request.auto_reject'
          : 'leave_request.submit',
      entityType: 'leave_request',
      entityId: String(created.id),
      details: { leaveType, startDate, endDate, status, autoRejectReason, skippedManagerStage },
      ip,
    });

    const clickupTaskId = await clickupLeaveSync.createTask(leaveRequestModel.toLeaveRequest(created));
    if (clickupTaskId) leaveRequestRepository.setClickupTaskId(created.id, clickupTaskId);

    const requiresDoctorNote = leaveType === 'sick' && timeOffRules.sickLeaveRequiresDoctorNote({ startDate: start, endDate: end });
    // Warn-only, response-time-only — never blocks submission (see
    // conflictPairService.findOverlaps' own comment). Also echoed here in
    // addition to the live pre-submit form check so the confirmation the
    // requester actually sees always reflects the same computation, even
    // if the live check was skipped or is stale by the time they submit.
    const conflictWarnings = conflictPairService.findOverlaps({ employeeId, startDate, endDate });
    return { ...leaveRequestModel.toLeaveRequest(created), requiresDoctorNote, conflictWarnings };
  }

  function listMine(employeeId) {
    return leaveRequestRepository.findByEmployeeId(employeeId).map(leaveRequestModel.toLeaveRequest);
  }

  // The 'manager' role is company-wide by design (the CEO's account, per
  // Overview's COMPANY_OVERVIEW_ROLES) — explicitly unscoped from
  // manager_employee_id routing on the user's decision, not the
  // direct-reports-only default docs/architecture.md §5.4 originally
  // flagged for confirmation. Anyone else (e.g. a department lead with
  // role 'employee' who has their own direct reports) still only sees
  // their own reports' requests.
  // Attaches the same warn-only conflict-pair check submit() echoes, so a
  // manager reviewing My Team sees it labeled on the card without a
  // separate fetch. Per-request (not per-employee) since it's the
  // request's own date range that matters for the overlap.
  function withConflictWarnings(request) {
    return { ...request, conflictWarnings: conflictPairService.findOverlaps({ employeeId: request.employeeId, startDate: request.startDate, endDate: request.endDate }) };
  }

  function listTeam({ actorEmployee, actorAuthRole }) {
    if (actorAuthRole === roles.MANAGER) {
      return leaveRequestRepository.findAll().map(leaveRequestModel.toLeaveRequest).map(withConflictWarnings);
    }
    if (!actorEmployee) return [];
    const reportIds = employeeRepository.findByManagerId(actorEmployee.id).map((row) => row.id);
    return leaveRequestRepository.findByEmployeeIds(reportIds).map(leaveRequestModel.toLeaveRequest).map(withConflictWarnings);
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
      availability: row.availability,
    }));
  }

  function listPcPending({ actorAuthRole }) {
    if (actorAuthRole !== roles.PEOPLE_CULTURE) {
      throw new EmployeesError('You do not have permission to view the company-wide approval queue.', 403);
    }
    return leaveRequestRepository.findByStatus('manager_approved').map(leaveRequestModel.toLeaveRequest);
  }

  // Backs P&C's Overview "policy breach" widget — auto_rejected requests
  // never pass through the manager_approved stage, so listPcPending above
  // never surfaces them; P&C otherwise has no way to see these at all.
  function listAutoRejected({ actorAuthRole }) {
    if (actorAuthRole !== roles.PEOPLE_CULTURE) {
      throw new EmployeesError('You do not have permission to view the company-wide approval queue.', 403);
    }
    return leaveRequestRepository.findByStatus('auto_rejected').map(leaveRequestModel.toLeaveRequest);
  }

  // Per-employee "how many of each leave type, and how did they resolve"
  // history for the two roles that actually review requests. Computed on
  // read from the existing rows (findByEmployeeId already exists) rather
  // than a stored counter — no write-path to keep in sync, always correct.
  // rejected/auto_rejected are deliberately merged (see the leave_requests
  // status comment in migration 002 — the PDF doesn't distinguish them
  // either); pending/manager_approved are "in progress"; cancelled gets its
  // own bucket so every column set sums exactly to `requested`.
  function getLeaveBreakdown({ employeeId, actorAuthRole }) {
    if (actorAuthRole !== roles.MANAGER && actorAuthRole !== roles.PEOPLE_CULTURE && actorAuthRole !== roles.ADMIN) {
      throw new EmployeesError('You do not have permission to view leave-request history.', 403);
    }
    const byType = {};
    VALID_LEAVE_TYPES.forEach((type) => {
      byType[type] = { leaveType: type, requested: 0, approved: 0, rejected: 0, inProgress: 0, cancelled: 0 };
    });
    leaveRequestRepository.findByEmployeeId(employeeId).forEach((row) => {
      const bucket = byType[row.leave_type];
      if (!bucket) return;
      bucket.requested += 1;
      if (row.status === 'approved') bucket.approved += 1;
      else if (row.status === 'rejected' || row.status === 'auto_rejected') bucket.rejected += 1;
      else if (row.status === 'pending' || row.status === 'manager_approved') bucket.inProgress += 1;
      else if (row.status === 'cancelled') bucket.cancelled += 1;
    });
    return VALID_LEAVE_TYPES.map((type) => byType[type]);
  }

  // Read-only, computed on read from the same rows getLeaveBreakdown uses —
  // no balance ledger/table (see the leave-balance plan's rationale: fixed,
  // non-configurable, non-prorated constants don't need one yet).
  function getMyBalances(employeeId) {
    const requests = leaveRequestRepository.findByEmployeeId(employeeId);
    return leaveBalanceRules.computeBalances(requests, {
      today: new Date(),
      countWorkingDaysInclusive: timeOffRules.countWorkingDaysInclusive,
    });
  }

  // Read-only preview of the exact same rule submit() enforces above — lets
  // the form warn before the requester commits, without changing what
  // actually gets auto-rejected at submission time.
  function checkNotice({ leaveType, startDate }) {
    if (!VALID_LEAVE_TYPES.includes(leaveType)) {
      throw new EmployeesError(`Leave type must be one of: ${VALID_LEAVE_TYPES.join(', ')}.`);
    }
    const start = parseDateOnly(startDate);
    if (!start) {
      throw new EmployeesError('startDate must be a valid date in YYYY-MM-DD format.');
    }
    return timeOffRules.checkNoticeWindow({ leaveType, submittedAt: new Date(), startDate: start });
  }

  async function managerDecision({ requestId, actorEmployee, actorAuthRole, decision, decisionNote, actorId, ip }) {
    if (!['approved', 'rejected'].includes(decision)) {
      throw new EmployeesError('Decision must be "approved" or "rejected".');
    }
    if (decision === 'rejected' && (!decisionNote || !decisionNote.trim())) {
      throw new EmployeesError('A comment is required when rejecting a request.');
    }
    const request = leaveRequestRepository.findById(requestId);
    if (!request) throw new EmployeesError('Leave request not found.', 404);
    if (request.status !== 'pending') {
      throw new EmployeesError('This request is no longer awaiting a manager decision.');
    }

    // No auth-role bypass here, including for the company-wide `manager`
    // role — a decision always requires being this specific employee's
    // direct manager. listTeam above keeps its company-wide *visibility*
    // bypass; this is action, not visibility, and stays scoped to the
    // actual reporting line for every role.
    const employee = employeeRepository.findById(request.employee_id);
    if (!employee || !actorEmployee || employee.manager_employee_id !== actorEmployee.id) {
      throw new EmployeesError("You are not this employee's manager.", 403);
    }

    const newStatus = decision === 'approved' ? 'manager_approved' : 'rejected';
    const updated = leaveRequestRepository.updateManagerDecision(requestId, {
      status: newStatus,
      managerDecisionBy: actorEmployee.id,
      decisionNote: decision === 'rejected' ? decisionNote.trim() : null,
    });

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
  async function pcConfirm({ requestId, actorEmployee, actorAuthRole, decision, decisionNote, salaryDeduction, unpaidDaysCount, actorId, ip }) {
    if (!actorEmployee || actorAuthRole !== roles.PEOPLE_CULTURE) {
      throw new EmployeesError('You do not have permission to confirm leave requests.', 403);
    }
    if (!['approved', 'rejected'].includes(decision)) {
      throw new EmployeesError('Decision must be "approved" or "rejected".');
    }
    if (decision === 'rejected' && (!decisionNote || !decisionNote.trim())) {
      throw new EmployeesError('A comment is required when rejecting a request.');
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
      decisionNote: decision === 'rejected' ? decisionNote.trim() : null,
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

  return { submit, listMine, listTeam, listOffToday, listPcPending, listAutoRejected, getLeaveBreakdown, getMyBalances, checkNotice, managerDecision, pcConfirm, cancel };
}

module.exports = createTimeOffService;
