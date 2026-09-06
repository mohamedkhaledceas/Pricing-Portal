/* conflict_pairs — inert extension point this pass (see the plan's §8:
   the old prototype's CONFLICT_PAIRS was dead data with no enforcement,
   and no source document defines what the rule should actually be). This
   repository exists so P&C can maintain the data; nothing calls it from
   the leave-submission flow yet. Do not infer a business rule from the
   existence of this file. */
const db = require('../../../db');

function findActiveForEmployee(employeeId) {
  return db
    .prepare(
      `SELECT * FROM conflict_pairs
       WHERE active = 1 AND (employee_id_a = ? OR employee_id_b = ?)`
    )
    .all(employeeId, employeeId);
}

function findAll() {
  return db.prepare('SELECT * FROM conflict_pairs ORDER BY id').all();
}

function findById(id) {
  return db.prepare('SELECT * FROM conflict_pairs WHERE id = ?').get(id);
}

// (A,B) and (B,A) are the same pair — order isn't meaningful, so duplicate
// detection (create/update) has to check both orderings.
function findByEmployees(employeeIdA, employeeIdB) {
  return db
    .prepare(
      `SELECT * FROM conflict_pairs
       WHERE (employee_id_a = ? AND employee_id_b = ?) OR (employee_id_a = ? AND employee_id_b = ?)`
    )
    .get(employeeIdA, employeeIdB, employeeIdB, employeeIdA);
}

function insert({ employeeIdA, employeeIdB }) {
  const info = db
    .prepare('INSERT INTO conflict_pairs (employee_id_a, employee_id_b) VALUES (?, ?)')
    .run(employeeIdA, employeeIdB);
  return findById(info.lastInsertRowid);
}

function update(id, { employeeIdA, employeeIdB }) {
  db.prepare('UPDATE conflict_pairs SET employee_id_a = ?, employee_id_b = ? WHERE id = ?').run(employeeIdA, employeeIdB, id);
  return findById(id);
}

// Hard delete — unlike employees/departments, no other table has a FK
// pointing at conflict_pairs.id, so removing a row can't orphan anything.
// This is just a preference/config row, not retained history.
function remove(id) {
  db.prepare('DELETE FROM conflict_pairs WHERE id = ?').run(id);
}

module.exports = { findActiveForEmployee, findAll, findById, findByEmployees, insert, update, remove };
