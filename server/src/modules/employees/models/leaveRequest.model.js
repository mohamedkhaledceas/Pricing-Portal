function toLeaveRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    // Legacy — no longer written by new requests (see migration 009), kept
    // only so pre-migration rows still render their original value.
    halfDay: row.half_day !== 0,
    halfDayPeriod: row.half_day_period,
    availability: row.availability,
    handoverEmployeeId: row.handover_employee_id,
    reason: row.reason,
    status: row.status,
    autoRejectReason: row.auto_reject_reason,
    managerDecisionBy: row.manager_decision_by,
    managerDecisionAt: row.manager_decision_at,
    managerDecisionNote: row.manager_decision_note,
    pcConfirmedBy: row.pc_confirmed_by,
    pcConfirmedAt: row.pc_confirmed_at,
    pcDecisionNote: row.pc_decision_note,
    salaryDeduction: row.salary_deduction,
    unpaidDaysCount: row.unpaid_days_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { toLeaveRequest };
