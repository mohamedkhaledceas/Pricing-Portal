/* employee_profile_change_requests table (migration 008) — only SQL here.
   One row per self-service edit an employee submits after their profile is
   locked (see rosterService.updateMine); `changes` is a JSON blob of the
   proposed {field: value} diff, applied verbatim by employeeRepository.update
   on approval. */
const db = require('../../../db');

const SELECT_WITH_NAMES = `
  SELECT
    r.*,
    eu.first_name AS employee_first_name,
    eu.last_name AS employee_last_name,
    ru.first_name AS reviewer_first_name,
    ru.last_name AS reviewer_last_name
  FROM employee_profile_change_requests r
  JOIN employees e ON e.id = r.employee_id
  JOIN users eu ON eu.id = e.user_id
  LEFT JOIN users ru ON ru.id = r.reviewed_by_user_id
`;

function insert({ employeeId, changes }) {
  const info = db
    .prepare('INSERT INTO employee_profile_change_requests (employee_id, changes) VALUES (?, ?)')
    .run(employeeId, JSON.stringify(changes));
  return findById(info.lastInsertRowid);
}

function findById(id) {
  return db.prepare(`${SELECT_WITH_NAMES} WHERE r.id = ?`).get(id);
}

function findPendingByEmployeeId(employeeId) {
  return db.prepare(`${SELECT_WITH_NAMES} WHERE r.employee_id = ? AND r.status = 'pending'`).get(employeeId);
}

function findAllPending() {
  return db.prepare(`${SELECT_WITH_NAMES} WHERE r.status = 'pending' ORDER BY r.created_at ASC`).all();
}

function decide(id, { status, reviewedByUserId, decisionNote }) {
  db.prepare(`
    UPDATE employee_profile_change_requests
    SET status = ?, reviewed_by_user_id = ?, decision_note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, reviewedByUserId, decisionNote || null, id);
  return findById(id);
}

module.exports = { insert, findById, findPendingByEmployeeId, findAllPending, decide };
