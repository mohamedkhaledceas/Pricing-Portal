/* control_room_kpi_targets + control_room_custom_kpis (migration 042).
   Only SQL here. */
const db = require('../../../../db');

const toCustom = (r) => ({
  id: r.id,
  key: `custom_${r.id}`,
  entity: r.entity,
  name: r.name,
  unit: r.unit,
  direction: r.direction,
  targetType: r.target_type,
  component: r.component,
  actual: r.actual,
  createdAt: r.created_at,
});

function listTargets(entity) {
  return db.prepare('SELECT kpi_id AS kpiId, target FROM control_room_kpi_targets WHERE entity = ?').all(entity);
}

function findTarget(entity, kpiId) {
  return db.prepare('SELECT id, target FROM control_room_kpi_targets WHERE entity = ? AND kpi_id = ?').get(entity, kpiId) || null;
}

function upsertTarget(entity, kpiId, target, userId) {
  db.prepare(`
    INSERT INTO control_room_kpi_targets (entity, kpi_id, target, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (entity, kpi_id) DO UPDATE SET target = excluded.target, updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(entity, kpiId, target, userId, new Date().toISOString());
}

function listCustom(entity) {
  return db.prepare('SELECT * FROM control_room_custom_kpis WHERE entity = ? AND archived = 0 ORDER BY id').all(entity).map(toCustom);
}

function findCustom(entity, id) {
  const r = db.prepare('SELECT * FROM control_room_custom_kpis WHERE entity = ? AND id = ? AND archived = 0').get(entity, id);
  return r ? toCustom(r) : null;
}

function insertCustom({ entity, name, unit, direction, targetType, component, actual }, userId) {
  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO control_room_custom_kpis (entity, name, unit, direction, target_type, component, actual, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(entity, name, unit, direction, targetType, component, actual, userId, now, now);
  return findCustom(entity, Number(lastInsertRowid));
}

function archiveCustom(id) {
  db.prepare('UPDATE control_room_custom_kpis SET archived = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

module.exports = { listTargets, findTarget, upsertTarget, listCustom, findCustom, insertCustom, archiveCustom };
