/* First Odoo tables — docs/adr/0013 §4. Owned by modules/management/finance.

   odoo_invoices / odoo_payments are read-only mirrors of Odoo
   (account.move customer invoices + credit notes, account.payment), keyed
   by Odoo's own id. They're a cache, not portal-owned history: the sync
   upserts in place and its reconcile pass removes rows whose Odoo record
   no longer exists — same status as commercial_lead_live_cache, so no
   other table may FK to them. Every row carries company_id; the portal's
   entity split (Ceas Comm / FZE / Learn with Marie) depends on it.

   Amounts: the *_signed columns are in the Odoo company's own currency
   (Odoo converts at the transaction date), the unsigned ones in the
   document's currency. Credit notes / outbound payments carry negative
   *_signed values, which is what lets revenue and cash sum directly.

   finance_settings is a single row (CHECK id = 1). No exchange-rate table
   by design — rates are fetched live (ADR-0013 §7).

   Client ↔ Odoo customer links live in migration 033's link table, not a
   column on clients (one client can map to several Odoo partners). */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS odoo_invoices (
      odoo_id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      move_type TEXT NOT NULL CHECK (move_type IN ('out_invoice', 'out_refund')),
      name TEXT,
      partner_id INTEGER,
      partner_name TEXT,
      invoice_date TEXT,
      invoice_date_due TEXT,
      state TEXT NOT NULL,
      payment_state TEXT,
      currency TEXT,
      amount_untaxed NUMERIC NOT NULL DEFAULT 0,
      amount_total NUMERIC NOT NULL DEFAULT 0,
      amount_residual NUMERIC NOT NULL DEFAULT 0,
      amount_untaxed_signed NUMERIC NOT NULL DEFAULT 0,
      amount_total_signed NUMERIC NOT NULL DEFAULT 0,
      amount_residual_signed NUMERIC NOT NULL DEFAULT 0,
      salesperson_name TEXT,
      odoo_write_date TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_odoo_invoices_company_date ON odoo_invoices(company_id, invoice_date);
    CREATE INDEX IF NOT EXISTS idx_odoo_invoices_partner ON odoo_invoices(partner_id);

    CREATE TABLE IF NOT EXISTS odoo_payments (
      odoo_id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      partner_id INTEGER,
      partner_name TEXT,
      partner_type TEXT,
      payment_type TEXT NOT NULL CHECK (payment_type IN ('inbound', 'outbound')),
      date TEXT,
      state TEXT NOT NULL,
      is_reconciled INTEGER NOT NULL DEFAULT 0,
      currency TEXT,
      amount NUMERIC NOT NULL DEFAULT 0,
      amount_company_currency_signed NUMERIC NOT NULL DEFAULT 0,
      journal_name TEXT,
      odoo_write_date TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_odoo_payments_company_date ON odoo_payments(company_id, date);
    CREATE INDEX IF NOT EXISTS idx_odoo_payments_partner ON odoo_payments(partner_id);

    CREATE TABLE IF NOT EXISTS odoo_sync_state (
      model TEXT PRIMARY KEY,
      last_write_date TEXT,
      last_run_at TEXT,
      last_success_at TEXT,
      last_status TEXT CHECK (last_status IN ('ok', 'error')),
      last_error TEXT,
      records_synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS finance_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      fx_mode TEXT NOT NULL DEFAULT 'live' CHECK (fx_mode IN ('live', 'fixed')),
      fixed_rates_json TEXT NOT NULL DEFAULT '{}',
      updated_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO finance_settings (id) VALUES (1);
  `);
}

module.exports = { up };
