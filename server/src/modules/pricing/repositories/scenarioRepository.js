/* scenarios — only SQL here. */
const db = require('../../../db');

function findByProjectId(projectId) {
  return db.prepare('SELECT * FROM scenarios WHERE project_id = ? ORDER BY sort_order ASC, id ASC').all(projectId);
}

function findById(id) {
  return db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id);
}

function nextSortOrder(projectId) {
  const row = db.prepare('SELECT MAX(sort_order) AS maxOrder FROM scenarios WHERE project_id = ?').get(projectId);
  return (row?.maxOrder ?? -1) + 1;
}

function insert({ id, projectId, name, hoursFactor, extra, price }) {
  db.prepare(`
    INSERT INTO scenarios (id, project_id, name, hours_factor, extra, price, sort_order)
    VALUES (@id, @projectId, @name, @hoursFactor, @extra, @price, @sortOrder)
  `).run({ id, projectId, name, hoursFactor, extra, price, sortOrder: nextSortOrder(projectId) });
  return findById(id);
}

function update(id, { name, hoursFactor, extra, price }) {
  const info = db.prepare('UPDATE scenarios SET name=@name, hours_factor=@hoursFactor, extra=@extra, price=@price WHERE id=@id')
    .run({ id, name, hoursFactor, extra, price });
  if (info.changes === 0) return null;
  return findById(id);
}

function remove(id) {
  const existing = findById(id);
  db.prepare('DELETE FROM scenarios WHERE id = ?').run(id);
  return existing || null;
}

module.exports = { findByProjectId, findById, insert, update, remove };
