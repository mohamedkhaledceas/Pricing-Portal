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

function insert({ employeeIdA, employeeIdB }) {
  const info = db
    .prepare('INSERT INTO conflict_pairs (employee_id_a, employee_id_b) VALUES (?, ?)')
    .run(employeeIdA, employeeIdB);
  return db.prepare('SELECT * FROM conflict_pairs WHERE id = ?').get(info.lastInsertRowid);
}

function setActive(id, active) {
  db.prepare('UPDATE conflict_pairs SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  return db.prepare('SELECT * FROM conflict_pairs WHERE id = ?').get(id);
}

module.exports = { findActiveForEmployee, findAll, insert, setActive };
