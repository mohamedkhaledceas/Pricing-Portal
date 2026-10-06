/* odoo_invoice_report_lines — a read-only mirror of Odoo's Invoices
   Analysis report (account.invoice.report), the model behind Odoo's
   Dashboards → Finance → Invoicing. Owned by modules/management/finance.

   Why a second invoice table: the "All companies" revenue must be Odoo's
   own number (user decision 2026-10-06 — the portal never picks an
   exchange rate). Read with all three companies allowed and Ceas Comm
   first, Odoo returns each line's price_subtotal already converted into
   Ceas Comm's currency (EGP) by its own method. odoo_invoices keeps each
   company's figures in that company's currency; this table holds only the
   consolidated view.

   One row per invoice line, posted invoices and credit notes only (credit
   notes negative). The conversion moves with Odoo's rates, so the sync
   replaces the whole table on every run instead of upserting by
   write_date. A cache like odoo_invoices: nothing may FK to it. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS odoo_invoice_report_lines (
      odoo_id INTEGER PRIMARY KEY,
      move_id INTEGER NOT NULL,
      move_name TEXT,
      move_type TEXT NOT NULL CHECK (move_type IN ('out_invoice', 'out_refund')),
      company_id INTEGER NOT NULL,
      invoice_date TEXT,
      partner_id INTEGER,
      partner_name TEXT,
      salesperson_name TEXT,
      product_name TEXT,
      category_name TEXT,
      price_subtotal_consolidated NUMERIC NOT NULL DEFAULT 0,
      consolidated_currency TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_odoo_invoice_report_lines_date ON odoo_invoice_report_lines(invoice_date);
  `);
}

module.exports = { up };
