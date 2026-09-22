/* direct_costs — only SQL here. */
const db = require('../../../db');

function findByProjectId(projectId) {
  return db.prepare('SELECT * FROM direct_costs WHERE project_id = ? ORDER BY sort_order ASC, id ASC').all(projectId);
}

function findById(id) {
  return db.prepare('SELECT * FROM direct_costs WHERE id = ?').get(id);
}

function nextSortOrder(projectId) {
  const row = db.prepare('SELECT MAX(sort_order) AS maxOrder FROM direct_costs WHERE project_id = ?').get(projectId);
  return (row?.maxOrder ?? -1) + 1;
}

function insert({ id, projectId, name, amount, currency }) {
  db.prepare(`
    INSERT INTO direct_costs (id, project_id, name, amount, currency, sort_order)
    VALUES (@id, @projectId, @name, @amount, @currency, @sortOrder)
  `).run({ id, projectId, name, amount, currency, sortOrder: nextSortOrder(projectId) });
  return findById(id);
}

function update(id, { name, amount, currency }) {
  const info = db.prepare('UPDATE direct_costs SET name=@name, amount=@amount, currency=@currency WHERE id=@id')
    .run({ id, name, amount, currency });
  if (info.changes === 0) return null;
  return findById(id);
}

function remove(id) {
  const existing = findById(id);
  db.prepare('DELETE FROM direct_costs WHERE id = ?').run(id);
  return existing || null;
}

module.exports = { findByProjectId, findById, insert, update, remove };
