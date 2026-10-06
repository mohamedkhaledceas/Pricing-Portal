/* Odoo's Profit and Loss inputs — owned by modules/management/finance.

   odoo_pnl_lines: posted journal items (account.move.line) on profit-and-
   loss account types, current and previous year, per company, in that
   company's own currency (balance: debit − credit). Odoo's Profit and Loss
   report (Accounting → Reporting → Profit and Loss) is exactly sums of
   these by account type — verified 2026-10-06 to the piastre
   (business-portal-tracker §6p). Replaced whole on every sync.

   odoo_currency_rates: Odoo's own dated rates for the currencies the
   all-companies P&L has to convert (AED), as Ceas Comm records them —
   inverse_rate is EGP per unit. Odoo's multi-company P&L converts a
   company's figures at the daily average of these over the report period
   (days before the first stored rate count as 1, as Odoo does). The portal
   reproduces that method with these rates; it never chooses a rate.

   Both are caches of Odoo: nothing may FK to them. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS odoo_pnl_lines (
      odoo_id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      account_type TEXT NOT NULL,
      balance NUMERIC NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_odoo_pnl_lines_company_date ON odoo_pnl_lines(company_id, date);

    CREATE TABLE IF NOT EXISTS odoo_currency_rates (
      odoo_id INTEGER PRIMARY KEY,
      currency TEXT NOT NULL,
      date TEXT NOT NULL,
      inverse_rate NUMERIC NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_odoo_currency_rates_currency_date ON odoo_currency_rates(currency, date);
  `);
}

module.exports = { up };
