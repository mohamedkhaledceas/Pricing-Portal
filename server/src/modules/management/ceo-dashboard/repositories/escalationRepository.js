/* control_room_escalation_routes + control_room_settings (migration 043).
   Only SQL here; both are seeded by the migration and only updated. */
const db = require('../../../../db');

function listRoutes() {
  return db.prepare('SELECT area, comes_to_ceo AS comesToCeo FROM control_room_escalation_routes ORDER BY rowid').all();
}

function findRoute(area) {
  return db.prepare('SELECT area, comes_to_ceo AS comesToCeo FROM control_room_escalation_routes WHERE area = ?').get(area) || null;
}

function updateRoute(area, comesToCeo, userId) {
  db.prepare('UPDATE control_room_escalation_routes SET comes_to_ceo = ?, updated_by = ?, updated_at = ? WHERE area = ?')
    .run(comesToCeo ? 1 : 0, userId, new Date().toISOString(), area);
}

function getThreshold() {
  const row = db.prepare('SELECT sign_off_threshold AS threshold FROM control_room_settings WHERE id = 1').get();
  return row ? row.threshold : null;
}

function updateThreshold(amount, userId) {
  db.prepare('UPDATE control_room_settings SET sign_off_threshold = ?, updated_by = ?, updated_at = ? WHERE id = 1')
    .run(amount, userId, new Date().toISOString());
}

module.exports = { listRoutes, findRoute, updateRoute, getThreshold, updateThreshold };
