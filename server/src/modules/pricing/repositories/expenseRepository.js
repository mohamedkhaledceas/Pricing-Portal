/* expenses — only SQL here. Same append-at-end sort_order convention as
   teamRepository. */
const db = require('../../../db');

function findAll() {
  return db.prepare('SELECT * FROM expenses ORDER BY sort_order ASC, id ASC').all();
}

function findById(id) {
  return db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
}

function nextSortOrder() {
  const row = db.prepare('SELECT MAX(sort_order) AS maxOrder FROM expenses').get();
  return (row?.maxOrder ?? -1) + 1;
}

function insert({ id, name, category, amount, freq, currency }) {
  db.prepare(`
    INSERT INTO expenses (id, name, category, amount, freq, currency, sort_order)
    VALUES (@id, @name, @category, @amount, @freq, @currency, @sortOrder)
  `).run({ id, name, category, amount, freq, currency, sortOrder: nextSortOrder() });
  return findById(id);
}

function update(id, { name, category, amount, freq, currency }) {
  const info = db.prepare(`
    UPDATE expenses SET name=@name, category=@category, amount=@amount, freq=@freq, currency=@currency
    WHERE id=@id
  `).run({ id, name, category, amount, freq, currency });
  if (info.changes === 0) return null;
  return findById(id);
}

function remove(id) {
  const existing = findById(id);
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  return existing || null;
}

module.exports = { findAll, findById, insert, update, remove };
