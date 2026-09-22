/* quote_lines — only SQL here. Sole source of truth for a project's
   quote.lines (see projectRepository's header comment). */
const db = require('../../../db');

function findByProjectId(projectId) {
  return db.prepare('SELECT * FROM quote_lines WHERE project_id = ? ORDER BY sort_order ASC, id ASC').all(projectId);
}

function findById(id) {
  return db.prepare('SELECT * FROM quote_lines WHERE id = ?').get(id);
}

function nextSortOrder(projectId) {
  const row = db.prepare('SELECT MAX(sort_order) AS maxOrder FROM quote_lines WHERE project_id = ?').get(projectId);
  return (row?.maxOrder ?? -1) + 1;
}

function insert({ id, projectId, name, amount }) {
  db.prepare(`
    INSERT INTO quote_lines (id, project_id, name, amount, sort_order)
    VALUES (@id, @projectId, @name, @amount, @sortOrder)
  `).run({ id, projectId, name, amount, sortOrder: nextSortOrder(projectId) });
  return findById(id);
}

function update(id, { name, amount }) {
  const info = db.prepare('UPDATE quote_lines SET name=@name, amount=@amount WHERE id=@id')
    .run({ id, name, amount });
  if (info.changes === 0) return null;
  return findById(id);
}

/* The frontend re-sends the whole quote object (including a line that may
   already exist) on every metadata edit, to avoid a shallow-merge on the
   project itself wiping quote.lines — so POST .../quote-lines has to
   tolerate a same-id repeat instead of crashing on the primary key.
   Create-or-merge by id, same as the legacy route's own comment explained. */
function upsert({ id, projectId, name, amount }) {
  const existing = findById(id);
  if (!existing) return insert({ id, projectId, name, amount });
  return update(id, {
    name: name !== undefined ? name : existing.name,
    amount: amount !== undefined ? amount : existing.amount,
  });
}

function remove(id) {
  const existing = findById(id);
  db.prepare('DELETE FROM quote_lines WHERE id = ?').run(id);
  return existing || null;
}

module.exports = { findByProjectId, findById, insert, update, upsert, remove };
