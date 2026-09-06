/* departments table — only SQL here. */
const db = require('../../../db');

function findAll() {
  return db.prepare('SELECT * FROM departments ORDER BY label ASC').all();
}

function findByCode(code) {
  return db.prepare('SELECT * FROM departments WHERE code = ?').get(code);
}

function findByLabel(label) {
  return db.prepare('SELECT * FROM departments WHERE label = ? COLLATE NOCASE').get(label);
}

function findById(id) {
  return db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
}

function insert({ code, label }) {
  const info = db.prepare('INSERT INTO departments (code, label) VALUES (?, ?)').run(code, label);
  return findById(info.lastInsertRowid);
}

function updateLabel(id, label) {
  db.prepare('UPDATE departments SET label = ? WHERE id = ?').run(label, id);
  return findById(id);
}

module.exports = { findAll, findByCode, findByLabel, findById, insert, updateLabel };
