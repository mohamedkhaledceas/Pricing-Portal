# ADR-0013: Odoo Integration — Read-Only Cached Sync, CEO Dashboard First

## Status
Accepted (2026-10-04). User confirmed the remaining definitions: VAT excluded from revenue, media pass-through included, and the defaults for items 3–7 below.

## Problem
The CEO dashboard (`management/ceo-dashboard`) renders entirely from `mockSnapshotRepository.js`. Its Revenue and Collections blocks — and most of the Business Portal's finance pillars (6, 7, 9, 11–13; `docs/governance/business-portal-tracker.md`) — need CEAS's real accounting data, which lives in Odoo. Access was verified on 2026-10-04 (tracker §6e–§6h); this ADR decides how that data enters the portal.

Verified facts this decision rests on (read-only probes, 2026-10-04):
- Odoo Online `ceas-comm1`, **Odoo 19 Enterprise**, full Accounting installed. The API key belongs to the user's personal account (uid 33) — no dedicated integration user is available (Enterprise seat limits). Key is persistent (no expiry).
- **Multi-company:** Ceas Comm (id 1, EGP), Ceas Comm FZE (id 2, AED), Learn With Marie (id 2268, EGP), Et3alemha (id 3, EGP — not visible to this account yet). JSON-2 calls return all allowed companies together by default.
- Volumes are small: 334 customer invoices/credit notes, 668 vendor bills, 1,183 payments, 5,084 journal items.
- **76 Odoo customers** have posted invoices (Ceas Comm 50, FZE 19, LWM 13). Only **16** of them match one of the portal's 174 `clients` rows automatically (15 by normalized name, 2 more by email/website domain) — the portal's clients came from the ClickUp pipeline, and naming differs between the two systems.
- Data quality limits: only **29 of 276** posted customer invoices have a payment term; only **8 of 332** invoice product lines carry an analytic account (the single analytic plan, "Project"); 295 of 332 lines have a product; salesperson set on 227 invoices; only 4 subscription sales orders.

## Decision

**1. Transport: Odoo 19 JSON-2 API, read-only by construction.** `POST /json/2/<model>/<method>` with `Authorization: bearer <key>` and `X-Odoo-Database`. Not XML-RPC/JSON-RPC (deprecated in Odoo 19). New `common/integrations/odooClient.js`, mirroring `clickupClient.js`'s role but reading `ODOO_URL`/`ODOO_DB`/`ODOO_API_KEY` **only through `config/index.js`** (unlike `clickupClient.js`'s documented `process.env` carve-out). It exports only `searchRead` and `searchCount` — no generic `call()`, no write methods — so writing to Odoo can't be wired in without someone consciously adding it (same precedent as `dealRecordRepository.js` exporting no `remove()`). This matters more than usual because the key carries the user's full personal Odoo permissions.

**2. Cache in the portal DB, never query Odoo per page load.** A scheduled job copies the needed Odoo records into local tables; the dashboard reads only local tables. Same model as ClickUp (`docs/adr/0004`): the portal stays fast and usable when Odoo is slow or down, and the sync-status line the dashboard already renders becomes real.

**3. Ownership: new `management/finance` sub-feature owns the Odoo cache tables, sync job, and sync-status read.** Matches the module placement decided 2026-09-24. `ceo-dashboard` reads finance data through `finance`'s service interface, never its repositories. The Finance page (built second) reuses the same tables.

**4. Tables (new migrations, starting at 032).** Only what the CEO dashboard's Revenue + Collections blocks need now:

| Table | Mirrors | Key columns |
|---|---|---|
| `odoo_invoices` | `account.move` where `move_type IN (out_invoice, out_refund)` | `odoo_id` PK, `company_id`, `move_type`, `name`, `partner_id` (the invoice's `commercial_partner_id` — the customer company, not the individual contact it was addressed to), `partner_name`, `invoice_date`, `invoice_date_due`, `state`, `payment_state`, `currency`, `amount_untaxed`, `amount_total`, `amount_residual`, `amount_untaxed_signed`, `amount_residual_signed` (company currency), `salesperson_name`, `odoo_write_date`, `synced_at` |
| `odoo_payments` | `account.payment` | `odoo_id` PK, `company_id`, `partner_id`, `payment_type`, `date`, `amount`, `currency`, `amount_company_currency_signed`, `state`, `journal_name`, `odoo_write_date`, `synced_at` |
| `odoo_sync_state` | — | `model` PK, `last_write_date`, `last_run_at`, `last_status`, `last_error`, `records_synced` |
| `finance_settings` | — | single row: `fx_mode` (`live` \| `fixed`), `fixed_rates_json`, `updated_by`, `updated_at` |
| `odoo_partners` | `res.partner` referenced by cached invoices | `odoo_id` PK, `name`, `email`, `website`, `vat`, `is_company` — added 2026-10-05 for §8 |
| `client_odoo_partner_links` | — | `client_id` → `clients`, `odoo_partner_id`, `status` (`linked` \| `rejected`), `decided_by`, `decided_at`; one client per partner — see §8 (amended 2026-10-05; replaces the planned `clients.odoo_partner_id` column) |

Vendor bills (`in_invoice`/`in_refund`) use the same `odoo_invoices` shape and are added with the Finance page, not now. Invoice lines are deferred until the service-line question below is answered.

**5. Sync mechanics.** `node-cron` job with the same reentrant-guard + immediate-startup-run shape as `jobs/clickupUserSyncSchedule.js`. Incremental by `write_date > odoo_sync_state.last_write_date`, upsert by `odoo_id`, interval from config (default 15 min). A nightly full ID reconcile removes cache rows whose Odoo record no longer exists (Odoo deletes draft moves). These tables are a mirror, not portal-owned history, so removal is correct here — the "revoke, never delete" rule covers portal-owned rows with history, same reasoning as `commercial_lead_live_cache`. Every query passes the explicit company list (`allowed_company_ids` in context) and every row stores `company_id`; a row is never written without one. Each multi-table write per run is one transaction. Sync runs are logged via `logger`, not `auditService` (system activity, not a user action); a change to `finance_settings` **is** audited.

**6. Entities.** A constant map in `management/finance`: `ceas → 1`, `fze → 2`, `lwm → 2268`. The dashboard's switcher becomes **Ceas Comm / Ceas Comm FZE / Learn with Marie / Consolidated** (FZE gets its own tab — user decision 2026-10-04). Et3alemha (id 3) is added to the map once its Odoo access is granted — **to be implemented, not deferred**. Not a table: four rows that change maybe once a year don't justify one, and adding a company still needs a code review either way.

**7. Currency — live or fixed, selectable; no rates table.** Rates change constantly, so they are not stored (user decision 2026-10-04). Two modes, chosen in `finance_settings`:
- **Live:** fetched from a public exchange-rate API at request time (candidate: `open.er-api.com` — free, no key, covers EGP/AED/USD/SAR), held in server memory for about an hour so every dashboard load doesn't hit the provider. The provider URL lives in `config/index.js`. If the provider is unreachable, the dashboard falls back to the fixed rates and says so.
- **Fixed:** rates the CEO/admin enter.

Conversion is only needed for **Consolidated** (FZE reports in AED). Within a company, Odoo already converts every foreign-currency invoice/payment into that company's currency at the transaction date (`*_signed` amounts), so per-entity views need no conversion. Known effect of live mode: past months in Consolidated are re-converted at today's rate, so a past month's consolidated total moves slightly day to day.

**8. Client linking — portal `clients` ↔ Odoo customers.** Goal: open a client in the portal and see all of their Odoo invoices and payments, alongside their ClickUp deals. `clients.odoo_partner_id` stores the link; invoices and payments are filtered by it. Because only 16 of 76 match automatically, linking follows the same rule as the 2026-09-27 client backfill: **suggested, then confirmed by a person, never auto-merged.** The sync proposes matches (normalized name, then email/website domain); a ceo/admin confirms, rejects, or creates a new portal client for an Odoo customer that has none. Until a customer is linked, the dashboard still groups invoices by the Odoo customer name, so nothing is hidden — linking only adds the cross-system view. Linking changes are audited.

*Amended 2026-10-05 (user decisions):* ClickUp has no client id of its own — a client is a name on each deal task — so the portal `clients` table (fed from ClickUp deals via `commercial_lead_deal_records.client_id`) is the ClickUp-side identity, and the mapping is **ClickUp deal → `clients.id` → Odoo partner(s)**. The link is a table, `client_odoo_partner_links`, not a column: Odoo already holds duplicate customer records (e.g. two "Paradaim Alarabia for Trade" partners), so one client can link to several partners; a partner links to at most one client. A rejected or unlinked pair is kept as `rejected` (not deleted), so it stops being suggested and the decision stays attributable. Reviewers: **ceo, admin, operations** (`USER_MANAGER_ROLES`, the Commercial Lead page's gate) — not ceo/admin only as first written. Suggestions ignore free-mail/social/shortener domains and CEAS's own domain. Odoo partners are cached by id from the invoice cache, not filtered by company (81 of 83 are shared across companies).

**9. Access.** Unchanged: CEO dashboard stays `ceo` + `admin` (`requireRole`). The sync-status endpoint uses the same gate. Client mapping (§8) is `ceo` + `admin` + `operations`. `finance` gets access when the Finance page ships (it's that page's audience), not before.

**10. Scope of the first build — CEO dashboard Odoo blocks only.**
- **Revenue:** YTD/MTD actuals, monthly series, top clients, trailing-90-day revenue, client concentration.
- **Collections:** total receivables, aging buckets, overdue-client detail, DSO.
- **Sync status line:** real `last_run_at`/status from `odoo_sync_state`.
- **Not Odoo, not in this ADR:** Pipeline (stays ClickUp — user decision 2026-10-04 — wired from the existing `commercial_lead_*` tables as a separate step), Delivery/Strategic (ClickUp), People (portal roster). These keep mock data until their own step.
- Each block carries a source badge (live vs. sample) so the "Prototype with mocked data" banner can be removed per block rather than all-or-nothing.

## Definitions (decided 2026-10-04)

These were flagged in `mockSnapshotRepository.js`'s own comments ("Odoo Reconciliation", 2026-08-24). Items 3–7 use the defaults in bold, accepted by the user.

1. ~~What "Revenue" means~~ — **Decided 2026-10-04:** total earned from operations before any costs, expenses or taxes are subtracted, i.e. **gross invoiced revenue**: posted customer invoices minus credit notes, by invoice date, in company currency. **Confirmed:** VAT excluded (untaxed amounts — VAT is collected for the government, not earned); media pass-through **included** (overrides the prototype's "net of pass-through" note).
2. ~~Collection rate formula~~ — **Decided 2026-10-04:** `Collection rate = (total cash collected in the period ÷ total amount billed in the period) × 100`. Uses "billed" (option A) as the denominator; switching to "amount due in the period" is a one-line change if Finance prefers it.
3. **Aging basis** — 247 of 276 invoices have no payment term, so `invoice_date_due` is mostly whatever Odoo defaulted. **Default: age by due date, and show the share of invoices without real terms.**
4. **Revenue targets** — Odoo has none. Either hide the target lines for now, or add a small monthly-targets entry (an early slice of pillar 14). **Default: hide until pillar 14.**
5. **Margin** — needs project-level cost, but only 8 invoice lines carry an analytic account. **Default: margin tile hidden in this phase.**
6. **Service lines / retainer-vs-project mix** — no reliable Odoo field today (analytics nearly unused, 4 subscriptions). Products exist on 295/332 lines, so a product → service-line mapping is possible. **Default: hidden in this phase.**
7. **Health score + Risks + Actions** — weights and rules in the mock are invented. **Default: keep mock for now and mark as sample.**

## Rules carried over from the original prototype

`ceas-ceo-dashboard.html` (supplied 2026-08-09) contains no real calculations — every figure is pre-computed in its embedded data. The only reusable logic is these thresholds and rules, kept as configuration (not hard-coded in render code):

| Rule | Value in the prototype |
|---|---|
| Client concentration | client's share of trailing-90-day revenue; risk above **25%** |
| DSO target | **55 days** |
| Collection-rate target | **85%** |
| Aged receivable risk | balance past **90 days**; also tracks share past **60 days** |
| "Delivering to a debtor" | client overdue while ClickUp shows active projects |
| "Delivered but unbilled" | project complete in ClickUp, no Odoo invoice after **15 days** |
| Health score | weighted composite: Financial 25, Collections 20, Pipeline 15, Delivery 20, People 10, Strategic 10. Consolidated = revenue-weighted average of entities. Bands: ≥70 good, ≥60 warning, ≥50 serious, <50 critical; "healthy floor" line at 70 |
| Pipeline (ClickUp) | weighted value = value × stage probability; coverage floor **2.0×** the quarter's new-business target |
| Delivery (ClickUp) | on-time floor **85%** |

The prototype never defines how a component score (e.g. Collections = 52) is derived from its metrics, so the health score stays sample data until those formulas are agreed (item 7 below).

## Alternatives considered
- **Query Odoo live on each dashboard load** — rejected: couples page speed and availability to Odoo Online, repeats the same queries for every viewer, and turns the personal-account key into a per-request dependency.
- **XML-RPC / JSON-RPC (`odoo.client`-style)** — rejected: deprecated in Odoo 19; JSON-2 is key-only auth with no username.
- **Mirror whole Odoo models (all fields, all move types) up front** — rejected: builds for pillars that aren't being built yet. Tables are added per consumer.
- **A `companies` table** — rejected for now (see §6).
- **Store daily currency rates (Odoo's `res.currency.rate` or the provider's)** — rejected per user decision: rates change constantly; live fetch + short in-memory cache + fixed fallback covers it without a table.
- **Auto-link clients by name** — rejected: 16/76 auto-matches means most links need a person anyway, and a wrong link silently attributes one client's invoices to another.
- **Reuse the Margin Planner's `company_settings.rates_json` for fixed FX** — rejected: it's the `pricing` module's table and serves pricing quotes; coupling the CEO dashboard's consolidation to quote rates would be a cross-module reach. Can be revisited if both should always match.

## Trade-offs
- The integration runs as the user's personal Odoo account. If that account is deactivated or the key is revoked, the sync stops. The dashboard shows stale data with the last successful sync time. Accepted; `docs/operations.md` gets a "rotate/replace the Odoo key" entry when this ships.
- Up to ~15 minutes of staleness. Acceptable for a CEO overview.
- Several dashboard tiles stay hidden or marked as samples until data quality (payment terms, analytics, products) or later pillars (targets) catch up.

## Consequences — explicit revisit triggers
- **Write to Odoo** — never without a new ADR.
- **Dedicated integration user** — switch to it if CEAS gets a spare Odoo seat.
- **Et3alemha** — add to the entity map once its Odoo access exists.
- **Salary from Odoo** — feasible (`hr.version.wage` holds a current wage for 29 of 30 Odoo employees, tracker §6g); to be implemented later via an explicit `employees.odoo_employee_id` link. Not part of this ADR's first build.
- **Historical DSO** — feasible: `account.partial.reconcile` (`max_date`, `amount`, matched journal items) rebuilt every invoice's current residual exactly (287/287, 2026-10-05). Needs receivable-line + partial-reconcile cache tables; build when the DSO trend is wanted.
- **Margin / service lines** — revisit once analytic accounts or products are used consistently on invoices and vendor bills.
