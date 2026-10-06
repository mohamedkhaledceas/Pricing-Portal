/* Portal `clients` — the writes the ClickUp dropdown sync makes (migration
   034). Only SQL. Nothing here deletes: a client removed from ClickUp is
   set inactive, an unmatched imported row becomes a 'lead', so the deal
   records and Odoo links that point at them keep pointing somewhere. */
const db = require('../../../../db');

const toSyncRow = (row) => ({
  id: row.id,
  name: row.name,
  clickupOptionId: row.clickup_option_id,
  kind: row.kind,
  isInternal: Boolean(row.is_internal),
  source: row.source,
  status: row.status,
});

function listAllForSync() {
  return db.prepare('SELECT * FROM clients').all().map(toSyncRow);
}

function insertFromClickup({ name, clickupOptionId, isInternal }) {
  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO clients (name, clickup_option_id, kind, is_internal, source, status, created_at, updated_at)
    VALUES (?, ?, 'client', ?, 'clickup', 'active', ?, ?)
  `).run(name, clickupOptionId, isInternal ? 1 : 0, now, now);
  return Number(lastInsertRowid);
}

/* An imported row whose name is exactly a dropdown name becomes that
   ClickUp client — same row id, so its deals and Odoo links stay. */
function attachOption(id, { name, clickupOptionId, isInternal }) {
  db.prepare(`
    UPDATE clients SET clickup_option_id = ?, name = ?, kind = 'client', is_internal = ?, updated_at = ?
    WHERE id = ?
  `).run(clickupOptionId, name, isInternal ? 1 : 0, new Date().toISOString(), id);
}

function updateFromClickup(id, { name, isInternal, status }) {
  db.prepare('UPDATE clients SET name = ?, is_internal = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(name, isInternal ? 1 : 0, status, new Date().toISOString(), id);
}

function setStatus(id, status) {
  db.prepare('UPDATE clients SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
}

function markLead(id) {
  db.prepare("UPDATE clients SET kind = 'lead', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

module.exports = { listAllForSync, insertFromClickup, attachOption, updateFromClickup, setStatus, markLead };
