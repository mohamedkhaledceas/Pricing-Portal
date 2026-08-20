const db = require('../../../db');
const { ROLES } = require('../../../common/constants/roles');

function findByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function findById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function existsByEmail(email) {
  return !!db.prepare('SELECT id FROM users WHERE email = ?').get(email);
}

function insert({ email, firstName, lastName, passwordHash, role }) {
  const info = db
    .prepare('INSERT INTO users (email, first_name, last_name, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run(email, firstName, lastName, passwordHash, role);
  return findById(info.lastInsertRowid);
}

function updateProfile(id, { firstName, lastName }) {
  db.prepare('UPDATE users SET first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(firstName, lastName, id);
  return findById(id);
}

function updatePasswordHash(id, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, id);
}

function updateRole(id, role) {
  db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(role, id);
  return findById(id);
}

function setActive(id, isActive) {
  db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(isActive ? 1 : 0, id);
  return findById(id);
}

function listAll() {
  return db.prepare('SELECT * FROM users ORDER BY created_at ASC, id ASC').all();
}

function countActiveAdmins() {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE role = ? AND is_active = 1').get(ROLES.ADMIN).n;
}

// Throttled in SQL rather than in the caller (authenticate.js runs this on
// every single authenticated request) — the WHERE clause turns most calls
// into a no-op write, capping the actual update rate at once per minute per
// user regardless of how often they hit the API. Deliberately doesn't touch
// updated_at, which elsewhere means "this profile was edited."
function touchLastSeen(id) {
  db.prepare(`
    UPDATE users
    SET last_seen_at = CURRENT_TIMESTAMP
    WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-60 seconds'))
  `).run(id);
}

module.exports = {
  findByEmail,
  findById,
  existsByEmail,
  insert,
  updateProfile,
  updatePasswordHash,
  updateRole,
  setActive,
  listAll,
  countActiveAdmins,
  touchLastSeen,
};
