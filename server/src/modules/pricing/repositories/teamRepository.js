/* team_members — only SQL here. No reorder endpoint exists, so insert()
   always appends at the end (MAX(sort_order) + 1); update() never touches
   sort_order, preserving the existing item's position. */
const db = require('../../../db');

function findAll() {
  return db.prepare('SELECT * FROM team_members ORDER BY sort_order ASC, id ASC').all();
}

function findById(id) {
  return db.prepare('SELECT * FROM team_members WHERE id = ?').get(id);
}

function nextSortOrder() {
  const row = db.prepare('SELECT MAX(sort_order) AS maxOrder FROM team_members').get();
  return (row?.maxOrder ?? -1) + 1;
}

function insert({ id, name, role, salary, extras, hours, util, override, currency }) {
  db.prepare(`
    INSERT INTO team_members (id, name, role, salary, extras, hours, util, override_value, currency, sort_order)
    VALUES (@id, @name, @role, @salary, @extras, @hours, @util, @override, @currency, @sortOrder)
  `).run({ id, name, role, salary, extras, hours, util, override, currency, sortOrder: nextSortOrder() });
  return findById(id);
}

function update(id, { name, role, salary, extras, hours, util, override, currency }) {
  const info = db.prepare(`
    UPDATE team_members SET name=@name, role=@role, salary=@salary, extras=@extras,
      hours=@hours, util=@util, override_value=@override, currency=@currency
    WHERE id=@id
  `).run({ id, name, role, salary, extras, hours, util, override, currency });
  if (info.changes === 0) return null;
  return findById(id);
}

function remove(id) {
  const existing = findById(id);
  db.prepare('DELETE FROM team_members WHERE id = ?').run(id);
  return existing || null;
}

module.exports = { findAll, findById, insert, update, remove };
