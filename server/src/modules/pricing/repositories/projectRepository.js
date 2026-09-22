/* projects — only SQL here. `quote_json` stores quote *metadata* only
   (num/date/valid/detail/disc/vat/scope/terms) — quote_lines (its own
   repository) is the sole source of truth for quote.lines. See the
   modules/pricing plan for why: the two used to only stay in sync as a
   side effect of the old full-state-rewrite write path. */
const db = require('../../../db');

function findAll() {
  return db.prepare('SELECT * FROM projects ORDER BY sort_order ASC, id ASC').all();
}

function findById(id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

function nextSortOrder() {
  const row = db.prepare('SELECT MAX(sort_order) AS maxOrder FROM projects').get();
  return (row?.maxOrder ?? -1) + 1;
}

function insert({ id, name, client, months, status, startMonth, currency, contingency, target, price, quoteJson }) {
  db.prepare(`
    INSERT INTO projects (id, name, client, months, status, start_month, currency, contingency, target, price, quote_json, sort_order)
    VALUES (@id, @name, @client, @months, @status, @startMonth, @currency, @contingency, @target, @price, @quoteJson, @sortOrder)
  `).run({ id, name, client, months, status, startMonth, currency, contingency, target, price, quoteJson, sortOrder: nextSortOrder() });
  return findById(id);
}

function update(id, { name, client, months, status, startMonth, currency, contingency, target, price, quoteJson }) {
  const info = db.prepare(`
    UPDATE projects SET name=@name, client=@client, months=@months, status=@status,
      start_month=@startMonth, currency=@currency, contingency=@contingency, target=@target,
      price=@price, quote_json=@quoteJson
    WHERE id=@id
  `).run({ id, name, client, months, status, startMonth, currency, contingency, target, price, quoteJson });
  if (info.changes === 0) return null;
  return findById(id);
}

function remove(id) {
  // project_lines/direct_costs/scenarios/quote_lines all declare
  // ON DELETE CASCADE against this table (db.js) — no app-level child
  // deletes needed.
  const existing = findById(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return existing || null;
}

module.exports = { findAll, findById, insert, update, remove };
