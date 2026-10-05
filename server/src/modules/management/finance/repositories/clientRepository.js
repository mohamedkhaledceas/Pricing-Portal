/* Portal `clients` (migration 026, owned by modules/management) — the
   reads and the single insert the client-mapping review needs. Only SQL. */
const db = require('../../../../db');

const toClient = (row) => ({
  id: row.id,
  name: row.name,
  website: row.website,
  primaryContactEmail: row.primary_contact_email,
  status: row.status,
});

function listActive() {
  return db.prepare("SELECT * FROM clients WHERE status = 'active' ORDER BY name COLLATE NOCASE").all().map(toClient);
}

function findById(id) {
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  return row ? toClient(row) : null;
}

function insert({ name, website, primaryContactEmail }) {
  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO clients (name, website, primary_contact_email, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run(name, website, primaryContactEmail, now, now);
  return findById(Number(lastInsertRowid));
}

module.exports = { listActive, findById, insert };
