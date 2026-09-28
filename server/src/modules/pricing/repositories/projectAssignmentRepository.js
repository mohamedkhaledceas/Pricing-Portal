/* project_assignments — only SQL here. Replaces project_lines' loose
   person_id (pointed at the free-text team_members table, no real FK) with
   employee_id, a real FK to employees.id (migration 030, tracker §4 item
   8). Unlike project_lines, no sort_order — nothing consuming this yet
   needs display ordering; that's UI-phase work, not schema work. */
const db = require('../../../db');

function findByProjectId(projectId) {
  return db.prepare('SELECT * FROM project_assignments WHERE project_id = ? ORDER BY id ASC').all(projectId);
}

function findById(id) {
  return db.prepare('SELECT * FROM project_assignments WHERE id = ?').get(id);
}

function insert({ projectId, employeeId, hours, roleOnProject }) {
  const result = db.prepare(`
    INSERT INTO project_assignments (project_id, employee_id, hours, role_on_project)
    VALUES (@projectId, @employeeId, @hours, @roleOnProject)
  `).run({ projectId, employeeId, hours, roleOnProject: roleOnProject || null });
  return findById(result.lastInsertRowid);
}

function update(id, { employeeId, hours, roleOnProject }) {
  const info = db.prepare('UPDATE project_assignments SET employee_id=@employeeId, hours=@hours, role_on_project=@roleOnProject, updated_at=CURRENT_TIMESTAMP WHERE id=@id')
    .run({ id, employeeId, hours, roleOnProject: roleOnProject || null });
  if (info.changes === 0) return null;
  return findById(id);
}

function remove(id) {
  const existing = findById(id);
  db.prepare('DELETE FROM project_assignments WHERE id = ?').run(id);
  return existing || null;
}

module.exports = { findByProjectId, findById, insert, update, remove };
