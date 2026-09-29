/* First table for the CEAS Business Portal work (see docs/governance/
   business-portal-tracker.md §1/§4, pillar 5 — Client Master Data). Owned
   by modules/management, same as commercial-leads and ceo-dashboard.

   This migration only creates the empty table — it is NOT populated here.
   Population is a separate, deliberately human-reviewed step (tracker §4
   item 4): re-running the existing buildClientIdentityResolver matching
   logic (quarterMetricsService.js) over historical deals, with each
   suggested group confirmed by a person before becoming a row, never
   auto-merged.

   Column choices, and what's deliberately left out, are recorded in the
   tracker rather than repeated here — the short version: everything below
   is either a real, already-populated ClickUp field (name, country,
   industry, contact/*, account_manager, currency, website, company_size)
   or a schema convention already used elsewhere in this app (status as a
   soft-delete-style flag, like departments.active). Finance Contact,
   Payment Terms, and Tax/VAT are left out because their real source
   (Odoo's Customer Master) hasn't been inspected yet — adding a guessed
   shape now risks a second migration later just to fix it. Commercial
   Owner and Contract Start/End are deal-level, not client-level, and
   belong on commercial_lead_deal_records instead. Services Purchased,
   Related Deals/Projects/Invoices, Outstanding Balance, Total Revenue,
   Gross Profit, and Margin% are all computed by joining to other tables at
   read time, never stored here — the same non-duplication principle
   already applied to the Profitability/P&L reporting layer.

   No FK yet: nothing references clients.id until commercial_lead_deal_records
   exists (the very next migration in this sequence). No unique constraint
   on name — duplicate-client prevention is a service-layer check (warn on
   a close match), not a DB-level rule that could wrongly block a real
   second client with a similar name. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      country TEXT,
      industry TEXT,
      website TEXT,
      company_size TEXT,
      primary_contact_name TEXT,
      primary_contact_email TEXT,
      primary_contact_phone TEXT,
      account_manager TEXT,
      currency TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
  `);
}

module.exports = { up };
