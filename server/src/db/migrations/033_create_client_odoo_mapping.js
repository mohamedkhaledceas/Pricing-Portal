/* Client mapping between the ClickUp side and Odoo (docs/adr/0013 §8, as
   amended 2026-10-05). Owned by modules/management/finance.

   ClickUp has no client id of its own — a client is a name on each deal
   task — so the portal's `clients` table (fed from ClickUp deals via
   commercial_lead_deal_records.client_id) is the ClickUp-side identity.
   A ClickUp deal reaches Odoo as: deal -> clients.id -> Odoo partner(s).

   odoo_partners: read-only mirror of the Odoo customers (res.partner)
   referenced by cached invoices — a cache like odoo_invoices, so rows can
   be removed and nothing may FK to it. Most Odoo partners are shared
   across companies (no company_id), so there's no company column here.

   client_odoo_partner_links: one row per (client, Odoo partner) decision a
   person made. 'linked' = confirmed same customer; 'rejected' = confirmed
   NOT the same (so it stops being suggested). Unlinking flips a link to
   'rejected' rather than deleting the row, keeping who decided what.
   A client may link to several partners (Odoo has duplicate customer
   records), but a partner links to at most one client (partial unique
   index). odoo_partner_id has no FK because its target is a cache. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS odoo_partners (
      odoo_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      website TEXT,
      vat TEXT,
      is_company INTEGER NOT NULL DEFAULT 0,
      odoo_write_date TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS client_odoo_partner_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      odoo_partner_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('linked', 'rejected')),
      decided_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      decided_at TEXT NOT NULL,
      UNIQUE (client_id, odoo_partner_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_odoo_links_one_client_per_partner
      ON client_odoo_partner_links(odoo_partner_id) WHERE status = 'linked';
  `);
}

module.exports = { up };
