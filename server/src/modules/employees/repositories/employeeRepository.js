/* employees table — deliberately joined with users on every read, since
   employees has no name/email of its own (identity stays owned by auth's
   users table; see the migration's comment for why). Only SQL here. */
const db = require('../../../db');

const SELECT_WITH_USER = `
  SELECT
    e.*,
    u.email AS user_email,
    u.first_name AS user_first_name,
    u.last_name AS user_last_name,
    u.role AS user_role,
    u.is_active AS user_is_active
  FROM employees e
  JOIN users u ON u.id = e.user_id
`;

function findAll() {
  return db.prepare(`${SELECT_WITH_USER} ORDER BY u.first_name, u.last_name`).all();
}

function findAllActive() {
  return db.prepare(`${SELECT_WITH_USER} WHERE e.active = 1 ORDER BY u.first_name, u.last_name`).all();
}

function findById(id) {
  return db.prepare(`${SELECT_WITH_USER} WHERE e.id = ?`).get(id);
}

function findByUserId(userId) {
  return db.prepare(`${SELECT_WITH_USER} WHERE e.user_id = ?`).get(userId);
}

function findByManagerId(managerEmployeeId) {
  return db.prepare(`${SELECT_WITH_USER} WHERE e.manager_employee_id = ? ORDER BY u.first_name, u.last_name`).all(managerEmployeeId);
}

function existsByUserId(userId) {
  return !!db.prepare('SELECT id FROM employees WHERE user_id = ?').get(userId);
}

function insert({ userId, clickupUserId, department, kpiProfile, managerEmployeeId, isPeopleCulture }) {
  const info = db
    .prepare(
      `INSERT INTO employees (user_id, clickup_user_id, department, kpi_profile, manager_employee_id, is_people_culture)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(userId, clickupUserId || null, department || null, kpiProfile || null, managerEmployeeId || null, isPeopleCulture ? 1 : 0);
  return findById(info.lastInsertRowid);
}

function update(id, { clickupUserId, department, kpiProfile, managerEmployeeId, isPeopleCulture }) {
  db.prepare(
    `UPDATE employees SET
       clickup_user_id = ?, department = ?, kpi_profile = ?, manager_employee_id = ?, is_people_culture = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(clickupUserId || null, department || null, kpiProfile || null, managerEmployeeId || null, isPeopleCulture ? 1 : 0, id);
  return findById(id);
}

function setActive(id, active) {
  db.prepare('UPDATE employees SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(active ? 1 : 0, id);
  return findById(id);
}

// Deliberately doesn't touch updated_at — this is a background reconciliation
// against ClickUp's member list (see services/clickupUserSync.js), not a
// user-initiated edit, and "unchanged since" queries elsewhere shouldn't
// have to account for it.
function setClickupUserId(id, clickupUserId) {
  db.prepare('UPDATE employees SET clickup_user_id = ? WHERE id = ?').run(clickupUserId, id);
}

module.exports = {
  findAll,
  findAllActive,
  findById,
  findByUserId,
  findByManagerId,
  existsByUserId,
  insert,
  update,
  setActive,
  setClickupUserId,
};
