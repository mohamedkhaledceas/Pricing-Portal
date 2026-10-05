/* client_odoo_partner_links (migration 033). Only SQL. No delete — a
   removed link becomes 'rejected', keeping who decided what. */
const db = require('../../../../db');

const toLink = (row) => ({
  clientId: row.client_id,
  odooPartnerId: row.odoo_partner_id,
  status: row.status,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
});

function listAll() {
  return db.prepare('SELECT * FROM client_odoo_partner_links').all().map(toLink);
}

function findPair(clientId, odooPartnerId) {
  const row = db.prepare('SELECT * FROM client_odoo_partner_links WHERE client_id = ? AND odoo_partner_id = ?')
    .get(clientId, odooPartnerId);
  return row ? toLink(row) : null;
}

function findLinkedByPartner(odooPartnerId) {
  const row = db.prepare("SELECT * FROM client_odoo_partner_links WHERE odoo_partner_id = ? AND status = 'linked'")
    .get(odooPartnerId);
  return row ? toLink(row) : null;
}

function upsert({ clientId, odooPartnerId, status, decidedBy }) {
  db.prepare(`
    INSERT INTO client_odoo_partner_links (client_id, odoo_partner_id, status, decided_by, decided_at)
    VALUES (@clientId, @odooPartnerId, @status, @decidedBy, @decidedAt)
    ON CONFLICT(client_id, odoo_partner_id) DO UPDATE SET
      status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at
  `).run({ clientId, odooPartnerId, status, decidedBy, decidedAt: new Date().toISOString() });
}

/* Confirmed links with the client's name, for grouping finance figures by
   portal client. Includes inactive clients — their history still counts. */
function listLinkedWithClientNames() {
  return db.prepare(`
    SELECT l.odoo_partner_id AS odooPartnerId, l.client_id AS clientId, c.name AS clientName
    FROM client_odoo_partner_links l
    JOIN clients c ON c.id = l.client_id
    WHERE l.status = 'linked'
  `).all();
}

module.exports = { listAll, findPair, findLinkedByPartner, upsert, listLinkedWithClientNames };
