/* odoo_invoices.invoice_origin — Odoo's "Source Document" on an invoice:
   the sales order(s) it was created from, empty when someone invoiced
   without going through a sales order. Odoo only counts an order as
   invoiced through linked invoices, so the share of unlinked invoices is
   what makes the Control Room's contracted backlog (migration 037)
   trustworthy or not. Filled by the next Odoo sync (startup runs a full
   one). */
function up(db) {
  const columns = db.prepare('PRAGMA table_info(odoo_invoices)').all().map((c) => c.name);
  if (!columns.includes('invoice_origin')) db.exec('ALTER TABLE odoo_invoices ADD COLUMN invoice_origin TEXT;');
}

module.exports = { up };
