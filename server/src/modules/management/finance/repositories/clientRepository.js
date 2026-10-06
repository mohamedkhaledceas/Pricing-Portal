/* Portal `clients` (migrations 026 + 034, owned by modules/management) —
   the reads and the single insert the client-mapping review and client
   book need. Only SQL. "Clients" here means real clients: kind 'client'
   and not CEAS's own internal dropdown entries; 'lead' rows (from the
   2026-09-27 deal import, never matched to ClickUp) are left out. */
const REAL_CLIENT = "kind = 'client' AND is_internal = 0";
const db = require('../../../../db');

const toClient = (row) => ({
  id: row.id,
  name: row.name,
  website: row.website,
  primaryContactEmail: row.primary_contact_email,
  status: row.status,
});

function listActive() {
  return db.prepare(`SELECT * FROM clients WHERE status = 'active' AND ${REAL_CLIENT} ORDER BY name COLLATE NOCASE`).all().map(toClient);
}

// Lead and internal rows aren't clients — linking to one is refused (404).
function findById(id) {
  const row = db.prepare(`SELECT * FROM clients WHERE id = ? AND ${REAL_CLIENT}`).get(id);
  return row ? toClient(row) : null;
}

function insert({ name, website, primaryContactEmail }) {
  const now = new Date().toISOString();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO clients (name, website, primary_contact_email, status, kind, source, created_at, updated_at)
    VALUES (?, ?, ?, 'active', 'client', 'odoo', ?, ?)
  `).run(name, website, primaryContactEmail, now, now);
  return findById(Number(lastInsertRowid));
}

/* Every client, active or not, with the profile fields the client book
   shows. Inactive clients keep their history, so they're listed too. */
const toClientProfile = (row) => ({
  id: row.id,
  name: row.name,
  status: row.status,
  country: row.country,
  industry: row.industry,
  website: row.website,
  companySize: row.company_size,
  primaryContactName: row.primary_contact_name,
  primaryContactEmail: row.primary_contact_email,
  primaryContactPhone: row.primary_contact_phone,
  accountManager: row.account_manager,
  currency: row.currency,
  clickupOptionId: row.clickup_option_id,
  source: row.source,
});

function listAllProfiles() {
  return db.prepare(`SELECT * FROM clients WHERE ${REAL_CLIENT} ORDER BY name COLLATE NOCASE`).all().map(toClientProfile);
}

function findProfileById(id) {
  const row = db.prepare(`SELECT * FROM clients WHERE id = ? AND ${REAL_CLIENT}`).get(id);
  return row ? toClientProfile(row) : null;
}

module.exports = { listActive, findById, insert, listAllProfiles, findProfileById };
