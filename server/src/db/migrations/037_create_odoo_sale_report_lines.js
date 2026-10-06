/* odoo_sale_report_lines — a read-only mirror of Odoo's Sales Analysis
   report (sale.report), the model behind Odoo's Dashboards → Sales →
   Sales and → Product. Owned by modules/management/finance.

   One row per sales-order line, every state (draft and sent quotations,
   confirmed orders, cancelled). Each amount is stored twice:
   - *_company: read with that company alone allowed — its own currency
     (EGP for Ceas Comm and Learn with Marie, AED for FZE);
   - *_consolidated: read with all three companies allowed and Ceas Comm
     first — converted into EGP by Odoo itself (same rule as migration
     035: the portal never chooses an exchange rate).
   order_date is the order's date in Africa/Cairo (Odoo stores UTC).

   The conversion follows Odoo's rates, so the sync replaces the table on
   every run. A cache of Odoo: nothing may FK to it. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS odoo_sale_report_lines (
      odoo_id INTEGER PRIMARY KEY,
      order_id INTEGER,
      order_name TEXT,
      company_id INTEGER NOT NULL,
      order_date TEXT,
      state TEXT NOT NULL,
      partner_id INTEGER,
      partner_name TEXT,
      salesperson_name TEXT,
      product_name TEXT,
      category_name TEXT,
      quantity NUMERIC NOT NULL DEFAULT 0,
      subtotal_company NUMERIC NOT NULL DEFAULT 0,
      to_invoice_company NUMERIC NOT NULL DEFAULT 0,
      subtotal_consolidated NUMERIC NOT NULL DEFAULT 0,
      to_invoice_consolidated NUMERIC NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_odoo_sale_report_lines_company_date ON odoo_sale_report_lines(company_id, order_date);
  `);
}

module.exports = { up };
