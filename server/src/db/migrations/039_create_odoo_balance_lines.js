/* odoo_balance_lines — posted journal items on balance-sheet accounts,
   every date since each company's books began, in that company's own
   currency. Owned by modules/management/finance.

   With odoo_pnl_lines (migration 036, which the sync now also reads from
   the beginning) this is everything Odoo's Balance Sheet report (Accounting
   → Reporting → Balance Sheet, account.report 4) and its Accounting
   dashboard's Cash block are built from:
   - running balances by account type, with receivable/payable split by
     the account's non_trade flag, as the report does;
   - debit/credit on bank, cash and credit-card accounts for cash received
     and spent in a period;
   - the account itself, so the bank balance can be listed per account.

   equity_unaffected lives in odoo_pnl_lines, not here. Replaced whole on
   every sync (~3,600 lines); a cache of Odoo — nothing may FK to it. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS odoo_balance_lines (
      odoo_id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      account_type TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      account_code TEXT,
      account_name TEXT,
      non_trade INTEGER NOT NULL DEFAULT 0 CHECK (non_trade IN (0, 1)),
      debit NUMERIC NOT NULL DEFAULT 0,
      credit NUMERIC NOT NULL DEFAULT 0,
      balance NUMERIC NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_odoo_balance_lines_company_date ON odoo_balance_lines(company_id, date);
  `);
}

module.exports = { up };
