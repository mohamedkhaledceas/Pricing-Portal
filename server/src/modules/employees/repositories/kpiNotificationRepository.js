/* employee_kpi_notifications — in-app KPI feedback notifications, scoped
   to this module (see the migration's comment for why this isn't a
   general framework). Only SQL here. */
const db = require('../../../db');

function insert({ userId, type, title, body, link }) {
  const info = db.prepare(`
    INSERT INTO employee_kpi_notifications (user_id, type, title, body, link)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, type, title, body || null, link || null);
  return db.prepare('SELECT * FROM employee_kpi_notifications WHERE id = ?').get(info.lastInsertRowid);
}

function listForUser(userId, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT * FROM employee_kpi_notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

function countUnreadForUser(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM employee_kpi_notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}

// Scoped to the owning user in the WHERE clause, not just the id — a
// caller can never mark someone else's notification read even by guessing
// an id, without a separate ownership check in the service layer.
function markRead(id, userId) {
  db.prepare(`
    UPDATE employee_kpi_notifications SET read_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND read_at IS NULL
  `).run(id, userId);
  return db.prepare('SELECT * FROM employee_kpi_notifications WHERE id = ? AND user_id = ?').get(id, userId);
}

module.exports = { insert, listForUser, countUnreadForUser, markRead };
