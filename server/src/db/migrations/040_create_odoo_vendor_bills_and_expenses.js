/* What the companies owe — owned by modules/management/finance.

   odoo_vendor_bills: Odoo vendor bills and refunds (account.move
   in_invoice / in_refund), every state, in the company's own currency.
   Amounts are stored the way a reader expects them: a bill positive, a
   vendor refund negative (Odoo's *_signed values are the other way round
   for purchases).

   odoo_expenses: Odoo employee expenses (hr.expense), every state —
   Dashboards → Finance → Expenses counts "to report" (draft), "to
   validate" (submitted for approval) and "to reimburse" (approved) from
   these. total_amount is in the company's currency.

   Both are small (hundreds of rows) and replaced whole on every sync, so
   deletions and state changes in Odoo always show. Caches of Odoo:
   nothing may FK to them. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS odoo_vendor_bills (
      odoo_id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      move_type TEXT NOT NULL CHECK (move_type IN ('in_invoice', 'in_refund')),
      name TEXT,
      ref TEXT,
      partner_id INTEGER,
      partner_name TEXT,
      invoice_date TEXT,
      invoice_date_due TEXT,
      state TEXT NOT NULL,
      payment_state TEXT,
      untaxed NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC NOT NULL DEFAULT 0,
      residual NUMERIC NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_odoo_vendor_bills_company ON odoo_vendor_bills(company_id, invoice_date);

    CREATE TABLE IF NOT EXISTS odoo_expenses (
      odoo_id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT,
      employee_name TEXT,
      date TEXT,
      state TEXT NOT NULL,
      payment_mode TEXT,
      total_amount NUMERIC NOT NULL DEFAULT 0,
      product_name TEXT,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_odoo_expenses_company ON odoo_expenses(company_id, state);
  `);
}

module.exports = { up };
