/* leave_requests table — only SQL here. */
const db = require('../../../db');

function insert({ employeeId, leaveType, startDate, endDate, halfDay, halfDayPeriod, handoverEmployeeId, reason, status, autoRejectReason, salaryDeduction }) {
  const info = db
    .prepare(
      `INSERT INTO leave_requests
        (employee_id, leave_type, start_date, end_date, half_day, half_day_period, handover_employee_id, reason, status, auto_reject_reason, salary_deduction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      employeeId,
      leaveType,
      startDate,
      endDate,
      halfDay ? 1 : 0,
      halfDayPeriod || null,
      handoverEmployeeId || null,
      reason || null,
      status,
      autoRejectReason || null,
      salaryDeduction || 'none'
    );
  return findById(info.lastInsertRowid);
}

function findById(id) {
  return db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
}

function findByEmployeeId(employeeId) {
  return db.prepare('SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY start_date DESC, id DESC').all(employeeId);
}

function findByEmployeeIds(employeeIds) {
  if (!employeeIds.length) return [];
  const placeholders = employeeIds.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM leave_requests WHERE employee_id IN (${placeholders}) ORDER BY created_at DESC`)
    .all(...employeeIds);
}

function findByStatus(status) {
  return db.prepare('SELECT * FROM leave_requests WHERE status = ? ORDER BY created_at ASC').all(status);
}

// Company-wide, unscoped — backs the manager role's "sees every request,
// not just direct reports" queue (see timeOffService.listTeam).
function findAll() {
  return db.prepare('SELECT * FROM leave_requests ORDER BY created_at DESC').all();
}

// Company-wide "who's off today" — joins into employees/users (both owned
// by this same module) since the Overview page needs names, not just ids.
function findApprovedOverlapping(date) {
  return db
    .prepare(
      `SELECT lr.*, e.department AS department, u.first_name AS first_name, u.last_name AS last_name
       FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       JOIN users u ON u.id = e.user_id
       WHERE lr.status = 'approved' AND lr.start_date <= ? AND lr.end_date >= ?
       ORDER BY u.first_name, u.last_name`
    )
    .all(date, date);
}

// WFH's monthly-quota check — yearMonth like '2026-08'. pending +
// manager_approved + approved all count against the quota (only a
// rejected/auto_rejected/cancelled request doesn't use up the month).
function countWfhInMonth({ employeeId, yearMonth }) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM leave_requests
       WHERE employee_id = ? AND leave_type = 'wfh'
         AND status IN ('pending', 'manager_approved', 'approved')
         AND substr(start_date, 1, 7) = ?`
    )
    .get(employeeId, yearMonth).n;
}

function updateManagerDecision(id, { status, managerDecisionBy }) {
  db.prepare(
    `UPDATE leave_requests SET status = ?, manager_decision_by = ?, manager_decision_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(status, managerDecisionBy, id);
  return findById(id);
}

function updatePcDecision(id, { status, pcConfirmedBy, salaryDeduction, unpaidDaysCount }) {
  db.prepare(
    `UPDATE leave_requests SET status = ?, pc_confirmed_by = ?, pc_confirmed_at = CURRENT_TIMESTAMP, salary_deduction = ?, unpaid_days_count = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(status, pcConfirmedBy, salaryDeduction, unpaidDaysCount ?? null, id);
  return findById(id);
}

function updateCancelled(id) {
  db.prepare("UPDATE leave_requests SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  return findById(id);
}

// Fire-and-log territory (see clickupLeaveSync.js) — doesn't touch
// updated_at, since this reflects a side-effect landing, not an edit to
// the request itself.
function setClickupTaskId(id, clickupTaskId) {
  db.prepare('UPDATE leave_requests SET clickup_task_id = ? WHERE id = ?').run(clickupTaskId, id);
}

module.exports = {
  insert,
  findById,
  findByEmployeeId,
  findByEmployeeIds,
  findByStatus,
  findAll,
  findApprovedOverlapping,
  countWfhInMonth,
  updateManagerDecision,
  updatePcDecision,
  updateCancelled,
  setClickupTaskId,
};
