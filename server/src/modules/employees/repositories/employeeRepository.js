/* employees table — deliberately joined with users on every read, since
   employees has no name/email of its own (identity stays owned by auth's
   users table; see the migration's comment for why). Only SQL here. */
const db = require('../../../db');

// user_online computed in SQL, not from `new Date(user_last_seen_at)` in JS —
// SQLite's CURRENT_TIMESTAMP is UTC text with no timezone marker, and Node's
// Date parser treats that "YYYY-MM-DD HH:MM:SS" shape as local time (see
// refreshTokenRepository.findRecentlyRevoked's comment for the same gotcha).
const SELECT_WITH_USER = `
  SELECT
    e.*,
    u.email AS user_email,
    u.first_name AS user_first_name,
    u.last_name AS user_last_name,
    u.role AS user_role,
    u.is_active AS user_is_active,
    u.last_seen_at AS user_last_seen_at,
    (u.last_seen_at IS NOT NULL AND u.last_seen_at >= datetime('now', '-5 minutes')) AS user_online
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

function insert({ userId, clickupUserId, department, kpiProfile, managerEmployeeId }) {
  const info = db
    .prepare(
      `INSERT INTO employees (user_id, clickup_user_id, department, kpi_profile, manager_employee_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, clickupUserId || null, department || null, kpiProfile || null, managerEmployeeId || null);
  return findById(info.lastInsertRowid);
}

// Genuinely partial — a field absent from the call (undefined) leaves its
// column untouched; only fields actually present get written (empty
// string/explicit null both clear it, same normalization insert() uses).
// Callers that mean to fully replace a row's editable fields, like
// roster.js's Save button, are expected to keep passing all of them every
// time — this only stops fields nobody mentioned from being wiped.
function update(id, { clickupUserId, department, kpiProfile, managerEmployeeId }) {
  const sets = [];
  const values = [];
  if (clickupUserId !== undefined) { sets.push('clickup_user_id = ?'); values.push(clickupUserId || null); }
  if (department !== undefined) { sets.push('department = ?'); values.push(department || null); }
  if (kpiProfile !== undefined) { sets.push('kpi_profile = ?'); values.push(kpiProfile || null); }
  if (managerEmployeeId !== undefined) { sets.push('manager_employee_id = ?'); values.push(managerEmployeeId || null); }
  if (sets.length === 0) return findById(id);

  sets.push('updated_at = CURRENT_TIMESTAMP');
  db.prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
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
