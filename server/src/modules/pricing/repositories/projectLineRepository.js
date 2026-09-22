/* project_lines — only SQL here. */
const db = require('../../../db');

function findByProjectId(projectId) {
  return db.prepare('SELECT * FROM project_lines WHERE project_id = ? ORDER BY sort_order ASC, id ASC').all(projectId);
}

function findById(id) {
  return db.prepare('SELECT * FROM project_lines WHERE id = ?').get(id);
}

function nextSortOrder(projectId) {
  const row = db.prepare('SELECT MAX(sort_order) AS maxOrder FROM project_lines WHERE project_id = ?').get(projectId);
  return (row?.maxOrder ?? -1) + 1;
}

function insert({ id, projectId, personId, hours }) {
  db.prepare(`
    INSERT INTO project_lines (id, project_id, person_id, hours, sort_order)
    VALUES (@id, @projectId, @personId, @hours, @sortOrder)
  `).run({ id, projectId, personId, hours, sortOrder: nextSortOrder(projectId) });
  return findById(id);
}

function update(id, { personId, hours }) {
  const info = db.prepare('UPDATE project_lines SET person_id=@personId, hours=@hours WHERE id=@id')
    .run({ id, personId, hours });
  if (info.changes === 0) return null;
  return findById(id);
}

function remove(id) {
  const existing = findById(id);
  db.prepare('DELETE FROM project_lines WHERE id = ?').run(id);
  return existing || null;
}

// No FK from person_id to team_members (loose reference, not enforced at
// the schema level) — called when a team member is deleted, so lines that
// referenced them don't keep pointing at a now-nonexistent id.
function clearPersonReferences(personId) {
  db.prepare('UPDATE project_lines SET person_id = NULL WHERE person_id = ?').run(personId);
}

module.exports = { findByProjectId, findById, insert, update, remove, clearPersonReferences };
