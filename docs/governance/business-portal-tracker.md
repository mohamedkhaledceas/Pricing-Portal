# CEAS Business Portal — Implementation Tracker

Living audit + execution queue for `CeasComm_Business_Portal_Requirements.docx` (`/Users/mohamedkhaled/Documents/ceas/`, created 2026-09-24) — an 18-pillar Commercial/Finance/CEO BI portal spec, separate from the two requirement docs `docs/governance/implementation-tracker.md` already covers (HR-portal sections + governance workflow). Kept as its own file deliberately: different domain, different pillar structure, no value in forcing one file to serve both.

**Status as of 2026-09-27: 100% planning/architecture. Zero migrations written, zero code written.** Per `CLAUDE.md`'s staged process, nothing below should turn into production code until a milestone here is explicitly approved and reflected in `docs/migration-plan.md`.

**Hard external blocker:** Odoo integration (credentials not yet in `server/.env` — user has Odoo Online access at `ceas-comm1.odoo.com`, Odoo 19 Enterprise, but hasn't generated/added an API key yet). Every pillar below is tagged **Odoo-blocked** or **Odoo-free** so work can proceed on the latter while access gets sorted.

**Update (2026-10-04): Odoo access blocker cleared — connection verified, no integration code yet.** `ODOO_URL`, `ODOO_DB`, `ODOO_API_KEY` are now set in `server/.env` (`ODOO_USERNAME` left empty — not needed, see §6e). The *access* blocker is gone; the *integration* (pillar 16) is still Not Started, so every Odoo-blocked pillar remains blocked on that build work, not on credentials.

---

## 1. Master Pillar Status

| # | Pillar | Status | Odoo? | Notes |
|---|---|---|---|---|
| 1 | Executive Overview | Not Started (mock prototype exists: `ceo-dashboard`) | Partial | Commercial half (pipeline) is Odoo-free; revenue/collections/cash halves are Odoo-blocked. Rebuild deferred until its dependencies (below) are real. |
| 2 | Lead Management | Architecture decided, not built | **Free** | See §2 — real ClickUp field data already discovered. |
| 3 | Deals & Sales Pipeline | Partially real (`commercial-leads`), extending | **Free** | Funnel/bucket/quarter-KPI infra already live and solid. |
| 4 | Commercial KPIs & Conversion | Partially real, extending | **Free** | Qualification rate, conversion rates, repeat-client rate already computed server-side. |
| 5 | Client Master Data | Architecture decided, not built | **Free** (Odoo enrichment later) | See §2. |
| 6 | Revenue & Invoicing | Not Started | **Blocked** | — |
| 7 | Collections & AR | Not Started (mock only) | **Blocked** | — |
| 8 | COGS & Direct Project Costs | Not Started | Mostly blocked | Estimated-COGS already exists (Margin Planner); Actual-COGS needs Odoo. |
| 9 | Operating Expenses (OPEX) | Not Started | **Blocked** | — |
| 10 | Client & Project Profitability | Not Started | Partial | Needs COGS-actual (blocked) + Revenue-actual (blocked). |
| 11 | Vendor Management & AP | Not Started | **Blocked** | — |
| 12 | Profit & Loss (P&L) | Not Started | **Blocked** | Pure composition over Odoo-sourced actuals. |
| 13 | Cash Flow & Cash Position | Not Started | **Blocked** | — |
| 14 | Targets, Budgets & Forecasting | Not Started | Partial | Target/budget entry + weighted-forecast-from-pipeline are Odoo-free; actual-vs-budget is blocked. |
| 15 | Performance Analysis by dimension | Not Started | Partial | Leads/Deals/Close-Rate breakdowns are Odoo-free; revenue/margin columns are blocked. |
| 16 | Odoo Integration & Data Mapping | **In Progress** — ADR-0013 Accepted; steps 1 (client) + 2 (tables + sync job) done 2026-10-04; step 3a (dashboard finance backend) done 2026-10-05 | Unblocked (credentials work, finance/CRM read access confirmed) | Connection test (§6e) and read-only app/model survey (§6f) done. **ADR-0013 Accepted 2026-10-04.** Step 1 `odooClient.js` + config DONE (§6i). Step 2 tables + `management/finance` sync job DONE (§6j). Step 3a finance metrics service + CEO dashboard backend wiring DONE (§6k). ClickUp↔Odoo client-mapping backend DONE (§6l). Next: 3b dashboard frontend (FZE tab, source badges, hide undefined tiles), then 3c Consolidated via live FX. Original step 3 plan: step 3 — CEO dashboard Revenue + Collections from the cache (via finance service), FZE tab, live FX, sync-status line → cache + sync-state tables → scheduled sync job → sync-status endpoint. |
| 17 | Users, Permissions & Audit Log | Partially real (auth+audit exist), extending | **Free** | See §3. |
| 18 | Reports, Export & Final QA | Not Started | **Free** | `utils/tableExport.js` — no dependency on anything else being done first. |

---

## 2. Real findings — Commercial side (pillars 2–5), from live data inspection

Not guesswork — pulled from the actual local DB (`server/data/app.db`, `commercial_lead_live_cache`, 238 real synced rows) and the actual `bucketService.js`/`quarterMetricsService.js` code, 2026-09-27.

**Status → funnel bucket mapping is already complete.** Every status the user found in ClickUp (leads, in progress, in queue, onboarding, stuck, lost, qualified, unqualified, contract completed, terminated by agency, terminated by client) is already in `STATUS_TO_BUCKET` (`bucketService.js`). No separate/hidden Lead-intake list exists — leads enter the same already-synced pipeline list (`LISTS.pipeline`) from day one.

**63 distinct custom fields already populated** on real synced deals, discovered by reading `fields_json` directly (names/types/coverage only, no client values pulled into any conversation or doc). Coverage is uneven (data-quality gap, not a code gap) — decision made: use available data, show a presentable "data incomplete" indicator rather than blocking on it.

| Doc field (pillar 2/5) | Real ClickUp field | Coverage |
|---|---|---|
| Contact Person | `'Contact Person '` | 158/238 |
| Email | `'Email'` | 148/238 |
| Phone/WhatsApp | `'Phone'` | 149/238 |
| Country | `'Country '` | 172/238 (highest) |
| Lead Source | `'Source '` | 155/238 |
| Lead Owner | `'Sales Person'` / `'Account Manager'` | ~51–52/238 |
| Service Interested | `'Services'` / `'Project type'` | ~51–53/238 |
| Estimated Value / Currency | `'Project Value'` / `'Currency'` | 14/238, 23/238 (sparse) |
| (bonus → Client Master) | `Company Size`, `Industry / Product Category`, `Website` | varies |
| (bonus, unmapped yet) | `Quote Stage` — possible hook for linking a Closed-Won deal to a Margin Planner project | 8/238 |
| (bonus, unmapped yet) | `Health`, `NPS Score`, `Engagement Level` — real-data precedent for `ceo-dashboard`'s currently-fabricated "health score" | varies |

**Explicitly deprioritized (user decision, 2026-09-27):** `Qualification Reason` and `Next Action`/`Next Action Date` don't exist as ClickUp fields today. Leave for later — not a current blocker.

### Schema decision: don't build on `commercial_lead_live_cache`

Verified by reading the table's actual schema and write path — it is a disposable, upsert-in-place mirror of ClickUp's *current* state (`dealRepository.upsert()` overwrites in place; `dealRepository.remove()` hard-deletes on ClickUp `taskDeleted`, list-drift, or reconciliation). Confirmed via schema inspection that `bucket_events`/`stage_history`/`daily_counts`/`quarter_snapshots` deliberately carry **no FK** to this table (survive its deletions by design); only `stage_tracking` cascades, correctly, since it's current-state-only.

**Decision:** two new durable tables, neither ever deleted by the sync process:
- **`clients`** — plain autoincrement `id` (matches `departments` precedent). Seeded via a one-time backfill reusing `buildClientIdentityResolver`'s matching logic (email/normalized-Client-Name union-find, per ADR-0010), **with mandatory human confirmation per group** — the matcher is a suggestion tool, never silent auto-merge (a bad merge would later corrupt financial history).
- **`commercial_lead_deal_records`** — one row per deal, upserted (not replaced-and-deleted) as the deal progresses, carrying `client_id` (nullable until resolved) as a real FK to `clients.id`. This is what "Related Deals" queries and historical KPI counts should read from — not the live cache. Also fixes a real latent bug found in passing: `dealRepository.countByListAndQuarter()` (the "Total Leads" cohort count) currently counts the live cache directly, so it can retroactively shrink if a deal is deleted before its quarter is frozen. Cheap fix once this table exists (or even sooner, using the already-durable `bucket_events` table) — flagged, not yet actioned.

**Known open question, not yet decided:** whether the identity-resolver backfill has any auto-accept threshold, or is always 100% human-reviewed.

---

## 3. Real findings — Cross-cutting (pillars 17–18) + Margin Planner integration

**Cross-module FK precedent extended.** `pricing.projects.client_id → management.clients.id` will be the second cross-module FK exception (after `employees.employee_roster.user_id → auth.users.id`) — needs `CLAUDE.md`'s module-boundary clause updated from singular "the one exception" to a documented list, plus a short ADR. Chosen shape: real FK (DB-enforced, `ON DELETE RESTRICT`) + service-interface read (`pricing` never queries `management`'s tables directly, only through `management/index.js`'s existing public-interface pattern).

**Margin Planner real-cost decision (user confirmed, option 2):** real employee salary replaces the free-text `pricing.team_members` shadow table. Verified: `employees` table has **no salary/cost column at all** today (`salary_deduction` is an unrelated leave-deduction-type enum). Plan:
- Add `salary`, `currency` columns to `employees` — that's it. No need to re-add the deliberately-dropped `working_hours`/`work_schedule` fields (migration 021) — hours/utilization/override are per-*assignment*, not per-*employee*.
- New join table `project_assignments (project_id, employee_id, allocation_hours or util_pct, override_rate, role_on_project, effective_from, effective_to)` replaces the array-of-FKs idea (rejected — breaks referential integrity, can't hold per-assignment metadata, can't answer "which projects is this person on" efficiently). This is what `team_members` evolves into.
- Cost-per-hour is **derived** at query time from `employees.salary` + the assignment row, never stored as a separate column (avoid drift — precedent: the `working_hours` field that was built then dropped).
- **New requirement surfaced, not yet designed:** field-level permission gating (Manager/Finance see raw cost, others see price/margin only) — `common/permissions.js` today only does page/action-level gating, this is a new kind of check for this codebase. Any write to `employees.salary` must call `auditService.record(...)`.

**Odoo integration constraint, logged for ADR-0013:** no dedicated integration user available (Enterprise seat limits) — the sync will run under the user's own personal Odoo account/permissions, not a scoped least-privilege service account. Accepted trade-off, not a blocker; needs the integration code to be conservative about what it writes.

---

## 4. Immediate next-action queue (Odoo-free work, in dependency order)

1. Extend `common/constants/roles.js` / `common/permissions.js` — add `commercial`, `account_management`; resolve `CEO`-vs-`manager` naming and `finance`'s dead-role status.
   - **`manager` → `ceo` rename: DONE (2026-09-27).** Migration `024_rename_manager_role_to_ceo.js` (SQLite table-rebuild, same pattern as 001/004), applied to the real local DB — 4 rows moved from `manager` to `ceo`, `PRAGMA foreign_key_check` clean, `schema_migrations` tracked. Updated `common/constants/roles.js`, `common/permissions.js`, `db.js`'s fresh-install schema, and every one of the 15 files (server + frontend) that hardcoded the `'manager'` literal — none of it touched the unrelated `manager_employee_id` reporting-line concept. Verified end-to-end live: started the server, logged in as a throwaway `ceo`-role test account, confirmed `GET /api/ceo-dashboard/snapshot` (now gated `requireRole([ROLES.CEO, ROLES.ADMIN])`) returns 200; throwaway user + its audit/refresh-token rows fully cleaned up afterward. Deliberately left untouched: migrations `001`/`004` (historical record) and the old pre-`email`-column bootstrap block in `db.js` (dead code path on any DB this old already accounts for).
   - **`commercial`/`account_management` additions: DONE (2026-09-27).** Migration `025_add_commercial_and_account_management_roles.js` (purely additive — no existing rows changed, unlike 024). Added to `roles.js`, `db.js`'s fresh-install schema, and the two frontend admin-UI role pickers (`pricing/views/js/users.js`, `employees/views/js/usersAdmin.js`) so they're actually assignable from the Users page now. Verified the CHECK constraint genuinely accepts both values with a live insert/cleanup test. Deliberately **not yet wired to any page-level permission gate** — there's no commercial/clients page for them to gate yet (that happens when those pages get built, per §4 items 2–4). `finance` remains a deliberately dead role for the same reason (Odoo-blocked pages) — tracked, not an oversight.
   - **Item 1 complete.** Next: §4 item 2, `clients` table migration.
2. **Migration: `clients` table — DONE (2026-09-27).** `026_create_clients_table.js`. Columns: `id`, `name` (NOT NULL), `country`, `industry`, `website`, `company_size`, `primary_contact_name/email/phone`, `account_manager` (plain text, not FK'd to `users` — a ClickUp workspace member isn't necessarily a Portal login), `currency`, `status` (`active`/`inactive`, soft-delete-style like `departments.active`), `created_at`/`updated_at`. No FK yet (nothing references it until item 3 exists), no unique constraint on `name` (dedup is a service-layer flag, not a DB rule). Deliberately excluded: Finance Contact/Payment Terms/Tax-VAT (unverified Odoo shape), Commercial Owner/Contract dates (deal-level, belongs on item 3 instead), Services Purchased/Related Deals/financial totals (computed by join, never stored — same principle as the Profitability/P&L reporting layer). Verified: schema, migration tracked in `schema_migrations`, and a live insert/default-values/cleanup sanity check.
3. **Migration + sync wiring: `commercial_lead_deal_records` table — DONE (2026-09-27).** `027_create_commercial_lead_deal_records.js`. Durable counterpart to the live cache: `deal_id` PK shared with (not FK'd to) `commercial_lead_live_cache.deal_id`; `client_id` nullable FK → `clients.id` (`ON DELETE RESTRICT`); `name`/`status`/`sales_person`/`account_manager`/`value`/`currency`/clickup timestamps. New `dealRecordRepository.js` — deliberately exports no `remove()` at all, so a delete can't be accidentally wired in later without someone consciously adding one. Wired into `clickupSyncService.js`'s `syncTaskRecord()` (the shared webhook + reconciliation path) right alongside the existing live-cache upsert — same trigger, same fresh data, but this table is never touched by `removeFromLiveCache`/reconciliation's delete path. New `fieldText`/`fieldNumber` helpers handle the `'users'`-type-field-is-an-array shape.
   - **Verified:** schema; direct repository test (insert, upsert-updates-not-duplicates, `setClientId`/`findByClientId`, null-safety on sparse fields, full cleanup); helper functions against realistic and edge-case field shapes (single-user, multi-user, missing, empty-array).
   - **Not verified, and can't be yet:** the real end-to-end pipeline (an actual ClickUp webhook/reconciliation run). `CLICKUP_API_KEY` in local `.env` is invalid — confirmed via a direct API call and via the dev server's own startup logs (401 on every scheduled sync job). **New finding, separate from the Odoo blocker:** worth checking whether the real Render deployment has a working key or the same problem — if the same, scheduled syncs are silently failing there too, independent of this work.
4. **Backfill: DONE (2026-09-27).** One-time script (`buildClientIdentityResolver` over `LISTS.pipeline`'s 210 deals, human-reviewed by evidence — see §6 decision log for the 2 corrected false-positive matches). Result: **174 clients created**, 177 deals linked, 33 pipeline deals left unlinked on purpose (30 no resolvable identity, 3 junk names — "test"/"Na"/"."). Verified multiple ways: total counts, `PRAGMA foreign_key_check` clean, the 3 real merges collapsed to 1 client each (2 deals apiece), the 2 corrected groups produced 5 genuinely separate clients (not merged with each other), a duplicate-name check surfaced "Rawan" ×2 which investigation confirmed are two real, different people (different email/phone/website each) — the resolver correctly kept them apart, not a bug.
   - **Known gap, not fixed here:** Active Clients (22 deals) and Client Offboarding (9 deals) — the other 2 tracked lists — have **zero client linkage**. `buildClientIdentityResolver` only ever ran against the pipeline list; extending it to these two lists is a separate, undecided scope item.
   - **Item 4 complete** (for the pipeline list). Next: items 5–6, `employees.salary`/`currency` + `project_assignments` (the Margin Planner real-cost work).
5. **Migration: `employees.salary`, `employees.currency` — DONE (2026-09-27).** `028_add_salary_and_currency_to_employees.js`. `salary REAL` nullable, no default (most of the 35 existing employees have no comp data yet — defaulting to 0 would misrepresent that). `currency TEXT DEFAULT 'EGP'`, matching `team_members`/`projects`/`expenses`' existing default. Plain `ALTER TABLE` (no CHECK constraint on either column, so no rebuild needed unlike migrations 024/025). **Confirmed with user: option (a)** — derive cost-per-hour at query time from salary + the per-assignment hours/utilization (next item), never store `cost_per_hour` as its own column (same drift risk as the dropped `working_hours` field). Verified: schema, all-NULL/EGP-default on existing rows, FK check clean, live write/read/revert test.
   - **Also surfaced and reset in this same pass (2026-09-27), grounded in reading the real code, not assumption:**
     - Confirmed `pricing.projects` dropdown is 100% manually populated (`projectRepository.findAll()` — no automated source) and the per-line person picker sources from `team_members`, not `employees` (`projects.js:33-46`).
     - Confirmed Team & Salaries tab (`teamService.js`) is plain manual CRUD, zero connection to `auth.users`/`employees` — matches what the user described.
     - Capacity/Scenarios tabs need **no separate fix** — both are pure computations over Team + Project data, so they inherit correctness automatically once items 6-8 land.
     - Quote tab: a real future automation (auto-fill client details from `clients` once `pricing.projects.client_id` exists) — not scheduled, just noted.
     - Expenses tab: OPEX-shaped, Odoo-blocked (pillar 9) — not a current-phase item.
     - Existing "Team (BD) view" PIN toggle in Settings reconfirmed as UI-only, not a real security boundary (same class of finding as the CEO dashboard nav array) — the real compensation-visibility gate must be server-side (item 7 below).
6. **Migrations: `project_assignments` + employees capacity fields — DONE (2026-09-27).** Turned out to need two migrations, not one — discovered by reading `personCalc()` directly rather than assuming: it needs a *person-level* monthly capacity assumption (hours, utilization %) distinct from *per-project* booked hours, and `employees` had neither.
   - `029_add_capacity_fields_to_employees.js`: `default_hours` (REAL, default 176, matches `team_members`' own default), `default_utilization_pct` (REAL, default 70), `override_rate` (REAL, nullable — mirrors `team_members.override_value`). Confirmed this does **not** reopen migration 021's decision (that dropped `working_hours`/`work_schedule` as an HR onboarding feature with no replacement intended) — this is a narrow, cost-modeling-only assumption for the same finance-role audience as salary, a different feature. `job_title` (already on `employees`) covers what `team_members.role` used to.
   - `030_create_project_assignments.js`: `id`, `project_id` (FK → `projects.id`, `RESTRICT`), `employee_id` (FK → `employees.id`, `RESTRICT`), `hours` (booked hours on this project — same role `project_lines.hours` already plays), `role_on_project` (nullable), timestamps. Explicitly handles "an employee can be on more than one project" (user, 2026-09-27) — a plain many-to-many join, no schema change needed for that. Deliberately no `effective_from`/`effective_to` (`project_lines` never tracked assignment history either — not adding premature complexity nothing asked for) and no unique constraint on the pair (matches `project_lines`' existing permissiveness).
   - **Verified, multiple passes:** schema + FK check clean; real insert; same employee assigned to **two different real projects** confirming multi-project support; `ON DELETE RESTRICT` actually blocks deleting an assigned employee *and* blocks deleting an assigned project (both tested by triggering the failure, not just reading the constraint); cleanup confirmed empty; confirmed the real pre-existing project used in the test (`atj4q8y`, "Brand identity — sample") was left untouched.
7. **`common/permissions.js` field-level gate — DONE (2026-09-27).** `canViewCompensation`/`canEditCompensation` — the first field-level check in this codebase (everything else here is page/action-level). `COMPENSATION_ROLES = [ceo, people_culture, finance, admin]`; `commercial`/`account_management`/`operations`/`employee` excluded. Kept as two separate functions (not one aliased to the other) even though they return the same thing today, so a future split (e.g. finance sees but doesn't edit) doesn't require touching call sites. **Verified:** ran both functions against all 8 real roles in the system (exact match to spec) and confirmed fail-closed on `undefined`/`null`/garbage-string input.
8. **Item 8a — Team & Salaries tab backend: DONE (2026-09-28).** Full rework, real security not cosmetic:
   - New `employees` module interface (`modules/employees/services/plannerExportService.js`, exposed via `container.js`): `listEmployeesForPlanner({ includeCompensation })` and `updateEmployeeCompensation(...)`. Redaction is owned by the module that owns the data — `employee.model.js`'s new `toPlannerEntry()` omits salary/currency/defaultHours/defaultUtilizationPct/overrideRate entirely from the object when `includeCompensation` is false, not just hides them client-side.
   - `employeeRepository.update()` extended to accept the new compensation fields (was missing them entirely — caught before it shipped as a silent no-op).
   - `pricing`'s router split from one blanket `requirePlannerAccess` gate into per-route gates: `requirePlannerAccess` (admin/ceo/operations, unchanged) on the general surface; new `requireTeamViewAccess` (that set ∪ `COMPENSATION_ROLES`) on `GET /team`; new `requireTeamEditAccess` (`COMPENSATION_ROLES` only) on `PUT /team/:id`. `POST`/`DELETE /team` removed entirely — employees aren't created/deleted from the Planner.
   - `teamService`/`teamController` rewritten to call the new employees interface instead of `team_members`. `stateService` (the frontend's actual initial-page-load fetch, `GET /api/state`) and `companyCostInputsService` (feeds the CEO dashboard's cost tile) both also fixed — both independently read `team_members` too, and would have silently gone stale/kept leaking salary to `operations` even after `/team` was fixed. `marginPlannerSummary.js`'s `personCalc()` updated for the new field names (`currency` not `cur`, `defaultHours` not `hours`, etc.) — would have silently computed wrong numbers (not crashed) otherwise.
   - `team_members` table/repository/model left physically intact but fully disconnected — per "no delete this," orphaned not removed.
   - **Verified with real HTTP requests, one throwaway user per role (ceo/operations/finance/people_culture/employee/commercial), not just unit-level:** `GET /team` — 200 with salary for ceo/finance/people_culture, 200 *without* salary for operations, 403 for employee/commercial. `PUT /team/:id` — 200 for ceo/finance/people_culture, 403 for operations/employee/commercial (operations can view the tab but not edit pay). `GET /state` redaction confirmed matching. Audit log confirmed recording every real compensation write with correct actor/entity. CEO dashboard's cost tile confirmed computing a *correct* number end-to-end (test salary write of 99999 appeared exactly as `payroll: 99999` in the live snapshot, proving the field-name fix actually works, not just avoids crashing). All test users, their audit/refresh-token rows, and the test salary value fully reverted afterward — user count back to exactly 49, `git status` clean.
   - **Item 8b — Estimator's person-dropdown / `project_lines` → `project_assignments` — DONE (2026-09-28).** New `projectAssignmentRepository.js`; `project.model.js`'s `toProjectLine` replaced by `toProjectAssignment` (renamed on purpose, not aliased — `employeeId` is a different id space than the old `personId`, calling it the same name would misrepresent compatibility that doesn't exist). `projectService.js`'s `createLine`/`updateLine`/`removeLine` and `compose()` reworked; `employeeId` is required (`project_assignments.employee_id` is a real non-nullable FK, unlike the old nullable `person_id`) — missing it now returns a clean 400, not a raw constraint error. `stateService.js`'s `composeProject` fixed too, same reasoning as its `team` field fix in 8a.
   - **Real bug caught and fixed by the verification pass itself, not by inspection:** the first version of migration 030 used `ON DELETE RESTRICT` on `project_assignments.project_id`. Deleting a project with any assignment threw a 500 instead of cascading. Checked the sibling child tables' actual schemas (`direct_costs`, `project_lines`) — both use `ON DELETE CASCADE` on `project_id`. Fixed migration 030 in place (safe — uncommitted, test-data-only) to match: `project_id` → `CASCADE`, `employee_id` stays `RESTRICT` (correct, deliberate asymmetry — a project's own children disappear with it, but an employee with live assignments must never be silently deletable).
   - **Verified with real HTTP requests:** created a real project, added an assignment with a real `employeeId`, confirmed 400 on a missing `employeeId`, confirmed the assignment round-trips correctly on read, confirmed **before the fix** that deleting the project 500'd and left orphaned rows, confirmed **after the fix** that the same sequence returns 200 and the assignment is actually gone (re-queried the table directly, not just trusted the response). Confirmed the real pre-existing project (`atj4q8y`) was untouched throughout. All test users/projects/assignments fully cleaned up afterward — user count back to exactly 49, `project_assignments` empty, `git status` clean.
   - **Item 8 fully complete.** Everything in the Odoo-free queue (§4 items 1-8) is now done and verified.
7. Design + implement field-level cost-vs-price permission gating.
8. `utils/tableExport.js`.
9. ADR: cross-module FK pattern (pricing ↔ management) — update `CLAUDE.md`'s module-boundary clause.
10. **ADR-0013 draft — DONE (2026-10-04), status Proposed.** `docs/adr/0013-odoo-integration-strategy.md`. Read-only JSON-2 client, cached tables owned by `management/finance`, 15-min incremental sync, 4 entity tabs, both FX modes, CEO dashboard Revenue + Collections first. Extra read-only probe for it: only 29/276 posted invoices have payment terms, 8/332 invoice lines have an analytic account, 295/332 have a product, currency rates update daily. Blocked on the ADR's 7 "Needs a decision" items (revenue definition, collection-rate formula, aging basis, targets, margin, service lines, health/risks). **Update (same day):** revenue = gross invoiced (user definition); collection rate = collected ÷ billed × 100; no rates table — live FX from a public API with in-memory cache + fixed fallback; `clients.odoo_partner_id` for per-client Odoo views, human-confirmed linking (auto-match only 16/76 Odoo invoiced customers); prototype `ceas-ceo-dashboard.html` checked — no real formulas, only thresholds, now captured in the ADR. Still open: VAT excluded? pass-through included? + items 3–7 defaults.

## 5. Blocked queue (resumes when `server/.env` has real `ODOO_*` values)

**2026-10-04:** `ODOO_*` values now real and verified (§6e). This queue now waits on pillar 16 (the sync itself) being built, not on credentials.

Pillars 6, 7, 9, 11, 13, 16 in full; the actuals-half of 1, 8, 10, 12, 14, 15.

## 6. Decision Log

| Date | Decision |
|---|---|
| 2026-09-24 | Module placement: `management/clients` (new), `management/commercial-leads` (extended in place), `management/finance` (new, later split into `billing`/`spend`/`cash`/`planning` sub-concerns + composition-only reports for Profitability/P&L/Performance-Analysis), `common/integrations/odooClient.js` (new, mirrors `clickupClient.js` but reads via `config/index.js` properly). |
| 2026-09-27 | Client identity backfill: human-reviewed, not auto-merged. |
| 2026-09-27 | Pricing↔management cross-module FK: real FK + service-interface read (not denormalized snapshot, not soft-validated-only, not event-driven). |
| 2026-09-27 | Margin Planner real cost: option 2 (replace shadow salary with real `employees.salary`), derived cost-per-hour, `project_assignments` join table instead of array-of-FKs. |
| 2026-09-27 | `commercial_lead_live_cache` ruled unsafe as a cross-module FK anchor; `clients` + `commercial_lead_deal_records` (both durable, never deleted) are the anchors instead. |
| 2026-09-27 | Odoo: Odoo Online, `ceas-comm1`, Odoo 19 Enterprise, personal-account credentials (no dedicated integration user available). Not yet configured in `.env`. |
| 2026-10-04 | Odoo transport: use Odoo 19's **JSON-2 API** (`POST /json/2/<model>/<method>`, `Authorization: bearer <key>`, `X-Odoo-Database` header) — key-only auth, so `ODOO_USERNAME` is unnecessary. Not XML-RPC/JSON-RPC (deprecated by Odoo in 19). To be formalized in ADR-0013. Integration stays **read-only** against Odoo until explicitly decided otherwise. |
| 2026-09-27 | Deprioritized: Qualification Reason, Next Action/Date fields (pillar 2) — revisit later. |
| 2026-09-27 | Data-completeness gaps (e.g., Estimated Value only 6% populated): use available data + a presentable incompleteness indicator, not a blocker. |

## 6a. Deferred: ongoing deal → client confirmation UI

Once the historical backfill (§4 item 4) runs, **new deals from that point on will accumulate with `client_id = NULL`** — the sync pipeline (`clickupSyncService.js`) only writes deal fields, it never runs the identity resolver or auto-assigns a client, by design (no silent merging). Confirmed via the backfill's own review (§6 decision log) that this caution is warranted — 2 of 5 real multi-deal candidate groups were false positives from email-based matching alone.

**Decision (2026-09-27):** defer building the confirmation UI (a "deals needing client confirmation" queue — suggest via the same resolver + corroborating fields, human clicks confirm/reject/create-new, never auto-assign). Per the user's standing sequencing preference ([[feedback_backend_first_heavy_manual_testing]] in memory), no frontend work starts until backend work across the Odoo-free items is fully built and manually re-tested. **Trigger to revisit:** when Client Master UI work actually starts, this confirmation queue is part of that phase, not a separate one. Until then, unlinked new deals are a known, accepted, growing gap — not a bug to chase.

## 6b. ClickUp workspace survey findings (2026-09-27) — where projects/clients actually live

Ran `getWorkspaceSurvey()` for real (first time with a working key). Full space/folder/list map now known. Relevant findings:

- **No ready-made "Projects" list exists anywhere in ClickUp** matching the Margin Planner's concept (a priced client engagement with budget/timeline/team). What exists instead: (1) the Commercial Lead space's sales pipeline (pre-delivery, already our data source), (2) the "Ceas Comm | Kitchen" space's "Ceas Comm Projects (EXT)" folder — per-service-line lists (Brand Communication, PR Campaigns, Media Production, Activations & Events, Printing, Website) that are **granular day-to-day production/deliverable trackers**, not project-with-budget entities (sampled task: `"Ceas Figures — Brand Identity"`, fields like Category/Requester/Posting Date, no budget/team concept).
- **Decision:** `pricing.projects` remains the authoritative, manually-created record for now. **Deferred plan** (not scoped in detail, not scheduled): auto-create/link a `pricing.projects` row when a `commercial-leads` deal reaches Closed-Won, referencing `client_id`. Revisit once the current Odoo-free backend sequence (items 1-8) is done.
- **Deferred enrichment opportunity:** a real "🗂️ Client Master" ClickUp list exists (Performance Marketing folder, list id `901523884476`) — 6 tasks, one per client, with real fields: `Revenue`, `Total Ad Spend`, `ROAs`, `Total Leads / Conversions`, `Health`, `NPS Score`. Confirms the CEO-dashboard mock's fabricated "health score" concept has a real precedent. Scoped narrowly to performance-marketing clients only (not all ~174 backfilled clients) — a future enrichment layer on top of Client Master Data, not a replacement for the identity-resolver backfill. Not built now.
- **Deferred, finer-grained automation idea:** Kitchen-space task `assignees` are real ClickUp users, and `employees.clickup_user_id` already exists (built for presence/roster sync) — task-level staffing could eventually be matched to real employees by ID rather than name-matching. This is task-granularity, not project-granularity, so it's a separate idea from `project_assignments` — not conflated with it, not scheduled.

## 6c. Team Reviews bug fixes — CSP-blocked inline handlers (2026-09-28, out of the Business Portal scope but done in this session)

User reported two Team Reviews bugs ("Go to Team Reviews" doesn't redirect; "Didn't work with them" checkbox doesn't collapse). Root-caused live in the browser rather than guessed at: the recent Helmet/CSP hardening set `script-src-attr 'none'`, which silently blocks **every inline event-handler attribute** (`onclick=`, `onchange=`, etc.) in the whole page, no console error. Proved it by calling `switchMainTab()` directly via JS (worked) vs. clicking the real button (did nothing).

**Scope turned out much bigger than 2 bugs:** confined entirely to the `employees` module — `pricing`/`management` already use `addEventListener` exclusively (0 occurrences). `employees` had **61 inline handlers across 9 files**: `roster.js` (22), `requestsCenter.js` (17), `overview.js` (6), `kpiMappingAdmin.js` (4), `usersAdmin.js`/`kpi.js`/`kpiPeerReview.js` (3 each), `team.js`/`teamsDirectory.js` (2 each).

**Decision (user chose):** fix all 61 properly now (event delegation), not a quick CSP-loosening mitigation.

**Pattern used throughout:** delegate one listener per stable container (bound once where the container persists across the tab's own re-renders, e.g. `#roster-content`, `#requests-content`, `#kpi-view-content`), reading `data-*` attributes instead of inline-attribute string interpolation. Containers that get recreated fresh per tab visit (`#roster-content`, `#requests-content`, `#teams-content`, `#ov-content` at app-init) need no double-bind guard; containers reused across sub-view switches within one visit (`#kpi-view-content`, shared by Overview/History/Team-Reviews/Frameworks/MappingAdmin sub-views) or re-rendered repeatedly after their own actions (`#users-content`, `#roster-content` again) got a `container._xBound` guard. Nested toggles (department card → member card; that in turn replaced `event.stopPropagation()` calls) are handled by checking the most-specific `closest()` match first and returning early — same effect, no propagation-stopping needed.

**Two real bugs the fix itself caught, not separate from it:**
- `renderKpi()` hardcoded `activeView = 'overview'` unconditionally — even with the click fixed, "Go to Team Reviews" would have landed on the wrong sub-view. Added an optional `initialView` param, threaded through `switchMainTab(tabId, btn, opts)` → `opts.kpiView` → the button's new `data-goto-kpi-view="peerReview"`.
- A genuine syntax error introduced mid-edit in `requestsCenter.js` (an edit accidentally deleted `pcConfirm`'s closing brace) — caught immediately via the browser's own console exception, not by silent failure.

**Verified live for real, not just by inspection** (throwaway `people_culture` test account, deactivated afterward — referenced by a review-window `set_by` FK so kept, not deleted):
- Bug 1 (redirect): confirmed lands directly on Team Reviews now.
- Bug 2 (collapse): confirmed collapses and re-expands correctly, doesn't affect sibling rows.
- `requestsCenter.js`: full reject flow (ask-reject → composed reject-note form → typed reason → confirm) exercised end-to-end with a real throwaway leave request — DB row correctly updated (`status`, `pc_decision_note`, `pc_confirmed_by`) — and the "My Requests" filter bar's delegated `input`/`change` events confirmed live.
- `roster.js`: department expand, nested member-card toggle (without collapsing the parent — proves the ordering-based replacement for `stopPropagation` actually works), department edit→cancel, a real field-change (job title) confirmed written to the DB then reverted, conflict-pair edit→cancel and delete→cancel confirmed against a real existing pair without disturbing it.
- Zero new console errors across the entire test session; all 10 touched files re-verified with `node --check` before and after; final repo-wide grep confirms zero real inline handlers remain anywhere in the module.
- All test data (throwaway account, leave request, job-title edit) fully reverted; `git status` shows exactly the 10 expected files.

## 6d. Team Reviews feature work — content rewrite, department grouping, review-window UI (2026-09-28)

Follow-on to §6c, same session. User requested (not bugs, feature changes): an intro paragraph above the questions, reworded questions with full text, dropping the `growth` dimension, sections grouped by department, and a UI for `people_culture`/`admin` to set the review window's open/close dates.

**Implementation, all in `kpiPeerReview.js`:**
- `QUESTIONS` array now holds the 5 final dimensions (collaboration, communication, reliability, attitude, contribution) with full question text; `growth` dropped per user's explicit go-ahead. Backend needed no change — `kpiPeerReviewService.js`'s `recomputeAggregate` already null-safely averages whatever dimensions are present per key.
- `INTRO_HTML` constant holds the user's exact requested intro/purpose copy, rendered once above all department sections.
- New `departmentSectionsHtml(roster, quarter)` groups the roster by `department`, resolves each code to its label via `window.Departments.labelFor` (alphabetically sorted sections), and renders `"<Label> Team Evaluation"` as a section header above that department's reviewer rows.
- New `canSetWindow()`/`windowFormHtml()`/`saveWindow()` add an Opens/Closes date UI, shown only to `people_culture`/`admin`, calling the **already-existing** `POST /api/employees/kpi/peer-review/window` endpoint (already server-side role-gated) — no backend change needed.

**Two real bugs the live-verification pass caught (same pattern as §6c — test in the browser, don't just read the diff):**
- `departmentSectionsHtml` called `window.Departments.labelFor(code)` without ever calling `window.Departments.load(apiFetch)` first. Every other consumer of this shared cache (`roster.js`, `team.js`, `teamsDirectory.js`) awaits `load()` alongside its own data fetch before rendering; `kpiPeerReview.js` didn't, because Team Reviews can be the very first view opened in a tab (e.g. via the Overview deep link fixed in §6c), so the cache was empty and section headers rendered as raw department codes (`AI_INNOVATION` instead of `AI & Innovation`). Fixed by adding `window.Departments.load(apiFetch)` to the existing `Promise.all` in `renderKpiPeerReview`.
- The "Submit All Reviews" footnote had a stale hardcoded `"all 6 ratings"` left over from before `growth` was dropped. Changed to `` `all ${DIMS.length} ratings` `` so it can't drift from the question list again.

**Verified live** (same reactivated `kpibugtest@example.com` `people_culture` test account as §6c, server started fresh, JS syntax-checked via `node --check` before and after both fixes):
- Deep-link from Overview lands directly on Team Reviews (regression check on §6c's fix, still good).
- Date-range Opens/Closes/Save Window control renders for the `people_culture` test account, pre-filled with the real existing window values.
- Full intro paragraph (all 3 bullets) renders verbatim above the sections.
- All 5 questions render with full wording and `*`; "Overall Performance Feedback" free-text renders without `*`.
- Department section header renders as `"AI & INNOVATION TEAM EVALUATION"` (correct, after the `Departments.load` fix — was the raw code before).
- Footnote reads "all 5 ratings" (correct, after the hardcoded-6 fix).
- Collapse-on-"Didn't work with them" still works correctly inside the new grouped layout, independent of sibling rows.
- No `Save Window` click was made during verification (read-only check against the existing window) — nothing to revert there. Test account deactivated (`users.is_active = 0`) and dev server stopped afterward.

**Still open, not resolved this session:** user mentioned a second "Go to Team Reviews" button on "the Teams page" — a full-repo search found only one such button (on Overview). Need to ask the user where the second one is/was, since it may point at a real second entry point that was missed, or may be a misremembering of the Overview button.

## 6e. Odoo connection test (2026-10-04)

Per explicit user request ("just test if the connection is up"), read-only only — no Odoo logic implemented, nothing written to Odoo, no repo code changed. One-off `node -e` script reading `server/.env`, key never printed.

| Check | Result |
|---|---|
| Server reachable (`/web/webclient/version_info`) | Yes — `ceas-comm1.odoo.com`, `19.0+e` (Odoo 19 Enterprise, confirms the 2026-09-27 assumption) |
| JSON-2 call **without** key (negative control) | `401` — auth genuinely enforced, so the next row isn't a false positive |
| JSON-2 `res.partner/search_count` with key | `200` — 2,214 partner records |
| JSON-2 `res.users/search_read` with key | `200` |

**Not yet proven:** read access to finance/CRM models (`account.move`, `account.payment`, `sale.order`, `crm.lead`) under this personal account's permissions, and which Odoo apps are installed. Both answered by the next step (read-only survey), which also resolves the "which Odoo apps are active" open question below.

## 6f. Odoo read-only survey (2026-10-04)

Done right after the connection test. Two scratchpad `node` scripts using only `search_count`/`search_read`/`read_group` — nothing written to Odoo, no repo code changed, key never printed. Runs as uid 33 (the user's personal account), tz `Africa/Cairo`.

**Installed apps (relevant ones):** full **Accounting** (`accountant`, `account_accountant`, `account_reports` — not Invoicing-only), Sales (`sale_management`) + **Subscriptions**, CRM, Purchase, Expenses, Project + Timesheets, analytic accounting, plus **Payroll** (`hr_payroll`). Also installed but out of scope: HR/Time Off/Appraisals/Recruitment/Attendances, Website/eCommerce/eLearning, marketing, Sign, Knowledge, WhatsApp, Studio.

**Read access + volume** (all companies this account can see, combined):

| Model | Records | Date range |
|---|---|---|
| `account.move` customer invoices/credit notes | 334 | 2024-05-20 → 2026-10-02 |
| `account.move` vendor bills/refunds | 668 | 2024-12-31 → 2026-10-01 |
| `account.move` journal entries | 1,234 | 2025-01-07 → 2026-10-01 |
| `account.move.line` | 5,084 | 2024-05-20 → 2026-10-02 |
| `account.payment` | 1,183 | 2025-01-07 → 2026-10-01 |
| `sale.order` | 397 | 2024-12-24 → 2026-10-04 |
| `crm.lead` | 430 | 2024-12-25 → 2026-10-04 |
| `purchase.order` | 70 | 2025-04-07 → 2026-10-04 |
| `hr.expense` | 284 | 2024-05-24 → 2026-09-22 |
| `project.project` | 39 (29 with no company) | — |
| `account.account` / `account.journal` / `account.analytic.account` | 533 / 33 / 37 | — |
| `res.partner` (companies) | 518 | — |

Every model above returned 200 — the personal account's permissions cover all finance/CRM models needed for pillars 6–13.

Customer invoice states: posted/paid 229, posted/not_paid 30, posted/partial 5, posted/in_payment 5, posted/reversed 7, cancel 46, draft 1 — enough real AR data for pillar 7.

**Multi-company — new finding, matters for ADR-0013.** Odoo holds **4 companies**: Ceas Comm (id 1, EGP, user's default), Ceas Comm FZE (id 2, AED), Et3alemha (id 3, EGP), Learn With Marie (id 2268, EGP). The account is allowed on 1, 2, 2268 only — requesting company 3 returns `AccessError: Access to unauthorized or invalid companies`. JSON-2 calls default to *all* allowed companies at once (default-context counts equal the all-companies counts), so the sync must filter/tag by `company_id` explicitly or it will silently mix companies. Per-company split (cust. invoices / vendor bills / payments / SOs): Ceas Comm 240/469/882/309, FZE 69/196/290/70, Learn With Marie 25/3/11/18.

**Currencies:** AED, EGP, SAR, USD active; FZE reports in AED, the others in EGP. Reporting across companies needs a currency-conversion rule (ADR-0013).

**Journals:** 33, duplicated per company (Customer Invoices/Vendor Bills/Misc/Cash ×3), banks: Credit Agricole EGP/USD, CIB, Emirates NBD AED/USD, Alex Bank (Personal), Others — relevant to pillar 13 (cash position).

**API key expiry:** user confirmed the key was created as **persistent** (no expiry). No rotation reminder needed for expiry; it still dies if the user's account is deactivated or the key is revoked — note for `docs/operations.md` when the integration ships.

## 6g. Scope answers + DB gap + Odoo payroll check (2026-10-04)

**User answers to §7's new questions:**
- **Companies:** all of them in scope. CEO dashboard prototype already models entities as Ceas Comm / Learn with Marie / Consolidated. Its mock note says LWM is "a separate analytic account" in Odoo — **wrong**: LWM is its own Odoo company (id 2268). Still open: where Ceas Comm FZE and Et3alemha sit in that entity switcher, and Et3alemha needs Odoo access granted to the integration account.
- **Currency:** support **both** — Odoo's own rate table and a fixed portal-configured rate, selectable.
- **Salary:** user asked whether portal salary can be fetched from Odoo instead of entered in the portal — checked below.

**Portal DB has no tables for Odoo data.** Checked every table in `server/data/app.db` (31 migrations): nothing for companies/entities, invoices, vendor bills, payments, journal items/accounts, Odoo expenses, sales orders, currency rates, or sync state. `expenses` (5 rows) is the Margin Planner's manual OPEX list, `clients` has no Odoo partner link. All of it is new migrations — exact table list goes in ADR-0013.

**Odoo payroll check (counts only, no salary values printed):**
- 30 active `hr.employee` (Ceas Comm 26, FZE 4); `hr.contract` no longer exists in Odoo 19 — contract data lives on `hr.version` (`wage`, `wage_type`, `currency_id`, `contract_date_start/end`, plus UAE `l10n_ae_total_salary`).
- **29 of 30** have a current version with `wage > 0` (22 `monthly`, 7 unset wage_type; 26 EGP, 3 AED). Read access works under the personal key.
- `hr.payslip`: only 3 ever (April 2025) — Payroll app is installed but not used for payslips, so **contract wage, not payslips**, is the usable source.
- **Linking is the hard part:** 11 Odoo employees have no `work_email`, only 2 are linked to an Odoo user — email matching won't cover everyone. Needs an explicit `odoo_employee_id` on `employees`, set once by a human. Couldn't measure real match rate locally: local `app.db` employees are test data (`ceastest.local`/`test.local`/`example.com` emails), real roster is on Render.
- Feasible: yes. Proposed for ADR-0013: Odoo `hr.version.wage` becomes the source of truth for `employees.salary`/`currency`; portal salary edit becomes read-only for linked employees; existing `canViewCompensation` gate unchanged; sync writes go through `auditService.record`.

## 6h. Portal-wide Odoo placement map (2026-10-04, proposal only — nothing implemented)

Inspected every page (`employees`, `pricing` / Margin Planner, `commercial-leads`, `ceo-dashboard`) and its real server-side role gate. Proposed placements, all read-only from Odoo, all filtered by Odoo company (Ceas Comm / FZE / LWM; Et3alemha to be implemented later):

| Page → section | Odoo data | Proposed roles |
|---|---|---|
| CEO Dashboard → Revenue, Collections, Pipeline-value, Company health, Risks/Actions; 4 tabs (Ceas Comm / FZE / LWM / Consolidated) | `account.move` (invoices), `account.payment`, `account.move.line`, `sale.order`/subscriptions, `crm.lead` | ceo, admin (unchanged) |
| New Finance page — Revenue & Invoicing, AR aging, Vendor bills/AP, OPEX, Cash by bank journal, P&L | `account.move`, `account.payment`, `account.move.line`+`account.account`, `account.journal` | finance, ceo, admin (gives the dead `finance` role its first page) |
| Commercial Lead → Active Clients (AM): invoiced / paid / outstanding per client | `account.move` by partner, via a new `clients.odoo_partner_id` link | current gate (admin/ceo/operations); open question whether to add commercial/account_management |
| Margin Planner → Dashboard "Where the money goes": actual vs planned monthly expenses | `account.move.line` expense accounts | admin/ceo/operations (current planner gate) |
| Margin Planner → Estimator/Projects: actual invoiced vs quoted price, actual vendor costs vs estimated direct costs | `account.move` + analytic accounts / `project.project` | admin/ceo/operations; cost figures stay behind `canViewCompensation` where salary-derived |
| Margin Planner → Settings → Exchange rates: optional "use Odoo rates" | `res.currency.rate` | admin/ceo/operations |
| KPIs → AM D2 "Invoices issued on time", D3 "Invoice collection rate" auto-filled instead of typed | `account.move` (`invoice_date`, `invoice_date_due`, `payment_state`, salesperson) | same as today's KPI entry gates |
| Employees → Requests/Overview: "My expense claims" status | `hr.expense` | the employee themself + P&C; **needs the employee↔Odoo link (to be implemented with salary-from-Odoo)** |

Deliberately **not** proposed: syncing Odoo Time Off (`hr_holidays`) into the portal's leave system (two sources of truth for leave), and P&C P3 retention from Odoo (portal roster already has joining/deactivation data). Odoo CRM (430 leads) vs ClickUp pipeline overlap is an open question (§7).

## 6i. Odoo build step 1 — read-only client + config (2026-10-04)

ADR-0013 marked **Accepted** (user: "go on" — VAT excluded, pass-through included, items 3–7 defaults).

**Built:**
- `server/src/config/index.js`: `odooUrl` (trailing slash stripped), `odooDb`, `odooApiKey` — first integration key read through `config/index.js` rather than `process.env` directly.
- `server/src/common/integrations/odooClient.js`: exports **only** `searchRead` and `searchCount`. Every call requires an explicit integer `companyIds` list (sent as `allowed_company_ids`); `searchRead` requires an explicit field list; 30 s timeout; Odoo error bodies reduced to exception name + message (the `debug` traceback is dropped); the key never appears in any error.
- Not wired into anything yet — no route, job, or module uses it.

**Verified manually against live Odoo (reads only):**
- Per-company counts of customer invoices: Ceas Comm 240, FZE 69, LWM 25; all three together 334 — matches the §6f survey, so company scoping works.
- `searchRead` on FZE returned only FZE rows.
- Failure paths: missing `companyIds` → 500 before any request; Et3alemha (id 3) → Odoo 403 `AccessError` surfaced as 502; missing field list → 500; unknown model → 404 surfaced as 502.
- Server boots and serves `/login` (200) with the config change.
- No lint config exists in `server/` (ESLint 9 flat config missing) — not checked by a linter, consistent with the known test-infra gap.

**Note for step 2 (sync):** sorting `invoice_date desc` returns drafts (no `invoice_date`) first — the sync must filter by `state` rather than rely on date ordering.

## 6j. Odoo build step 2 — cache tables + sync job (2026-10-04)

Branch: **`feature/odoo-integration`** (created from `origin/main` after PR #72 merged; upstream unset so a bare push can't target `main`). Steps 1 + 2 uncommitted on it.

**Built:**
- Migration `032_create_odoo_finance_tables.js`: `odoo_invoices` (customer invoices + credit notes; `partner_id` = Odoo `commercial_partner_id`), `odoo_payments`, `odoo_sync_state` (+ `last_success_at`), `finance_settings` (single row, `CHECK id = 1`, seeded `fx_mode='live'`), `clients.odoo_partner_id` + partial unique index. No FKs into the cache tables (they're a mirror, rows can be removed).
- New `modules/management/finance/`: `constants.js` (entity → Odoo company map: ceas 1, fze 2, lwm 2268; Et3alemha to be implemented), `models/odooRecord.model.js` (field lists + Odoo→row mappers; `false`→null, many2one→id/name), three repositories + `unitOfWork.js`, `services/odooSyncService.js` (factory DI), `jobs/odooSyncSchedule.js`, `container.js`. Wired through `management/container.js` + `index.js`; started from `src/index.js` after listen.
- Sync: full on startup and nightly 03:00 Africa/Cairo; incremental every `ODOO_SYNC_MINUTES` (default 15, via `config/index.js`) by `write_date >=`; each model's rows + state in one transaction; one model failing doesn't stop the other. Full sync removes cached rows Odoo no longer has, **except** when Odoo returns nothing while the cache has rows (logged warning, cache kept). Rows without a company are refused. No ODOO_* env → schedule skipped with one info log.
- No routes yet — nothing reads the tables until step 3.

**Verified (on a copy of the dev DB via `DB_DIR`, not the real `server/data/app.db`):**
- Migration: recorded in `schema_migrations`; second `finance_settings` row rejected by CHECK; linking two clients to one Odoo customer rejected by UNIQUE; clients still 174; `foreign_key_check` clean.
- Full sync vs live Odoo: invoices 334/334, payments 1,183/1,183; per company 240 / 69 / 25; zero rows without company.
- Posted-invoice **untaxed and outstanding totals match Odoo's own `read_group` sums exactly for all 3 companies** (compared as match/mismatch only — no amounts printed).
- Incremental: re-fetches only the boundary record (1 per model).
- Removal: a planted fake Ceas Comm row was removed by full sync; a planted out-of-scope (company 3) row was left alone.
- Failure: an Et3alemha-scoped run recorded `error` state with the Odoo 403 message, cache unchanged, `last_success_at` kept; next good run reset state to `ok`.
- Empty-answer guard: a stub client returning nothing removed 0 rows, cache intact.
- Server boot with creds: startup full sync completed in ~0.75 s, `/login` 200, API key absent from logs. Without creds: "not scheduled" log, `/login` 200.

**Not done / to note:** the real local `server/data/app.db` gets migration 032 + first sync the next time the dev server starts. Render needs `ODOO_URL`/`ODOO_DB`/`ODOO_API_KEY` (and optionally `ODOO_SYNC_MINUTES`) set before the sync runs there. Odoo 19 payment states are `draft`/`in_process`/`paid`/`canceled` — step 3 must decide whether "cash collected" counts `in_process` (posted, not yet bank-reconciled) or only `paid`.

## 6k. Odoo build step 3a — finance metrics + CEO dashboard backend (2026-10-05)

Step 3 split into 3a (backend), 3b (frontend), 3c (Consolidated + live FX) so each can be checked separately.

**Built (uncommitted, `feature/odoo-integration`):**
- `management/finance/services/financeMetricsService.js` (factory DI) — finance's public read interface: `getEntityFinance(entityKey)` → `{ asOf, currency, revenue, collections }`, `getSyncStatus()`, `isFinanceEntity()`. Read queries added to the invoice/payment repositories; `toOpenInvoice` mapper in the model.
- Definitions as implemented: revenue = posted `amount_untaxed_signed` by invoice date (Cairo calendar); YTD/MTD/monthly; trailing-90-day clients (top 10 + Other, salesperson from latest invoice, overdue per client); concentration = top client ÷ trailing-90. Collections: receivables = posted open `amount_residual_signed`; aging by due date in 5 buckets (Not yet due / 1–30 / 31–60 / 61–90 / 90+); past-60 share; share of open invoices without real terms (due = invoice date); DSO = receivables ÷ last-90-days billing × 90; collection rate MTD = customer cash ÷ billed, **both VAT-inclusive** (cash includes VAT); overdue detail per client.
- `constants.js`: `ENTITIES` (company id + currency), `COLLECTED_PAYMENT_STATES = ['paid']` (first built as `paid + in_process`; **user decision 2026-10-05: exclude `in_process`** — not reconciled to the bank = not collected; affects 8 LWM payments dated 2025-07 → 2026-07), `FINANCE_THRESHOLDS` (25% concentration, 55-day DSO, 85% collection rate, 60/90-day aging) from the ADR's carried-over rules.
- `ceoDashboardService` converted to a factory wired in `ceo-dashboard/container.js` (was `require()`-ing the mock directly). For `ceas`/`fze`/`lwm` it replaces mock Revenue + Collections with Odoo figures, keeping only the Margin Planner's live `costs`; every other mock revenue field (targets, margin, service lines, mix, LWM funnel) is dropped per ADR-0013 definitions 4–6. Each entity carries `sources` (`odoo`/`sample`); on a cache-read failure it falls back to the mock, badged `sample`. Shell `asOf` is now today (Cairo); Odoo sync line is real from `odoo_sync_state` (error text kept in logs only), ClickUp line flagged `sample`. New `fze` entity (Revenue/Collections only); `getBrief` returns null for entities without a sample brief.
- Not yet: no DSO history series (historic receivables need reconciliation dates we don't cache); "live projects" column (ClickUp join) and Consolidated stay for later steps.

**Verified (scratch DB copy + live full sync, 334 invoices / 1,186 payments):** aging buckets sum exactly to receivables for all 3 companies; overdue total fixed to come from aging (per-client sum overstated it when credit notes leave a client net negative); unknown entity → `ValidationError`; Consolidated still sample; files pass `node --check` (no ESLint config exists in the repo).

**Decisions 2026-10-05 (user):** (1) cash collected = `paid` only — applied. (2) collection rate VAT-inclusive on both cash and billed confirmed; revenue stays ex-VAT. (3) investigate reconciliation dates before accepting current-only DSO — done, see below. (4) new requirement: ClickUp ↔ Odoo client mapping with an authorized review/fix flow — next after this, design pending approval.

**Reconciliation-date probe (read-only, 2026-10-05):** Odoo exposes `account.partial.reconcile` via JSON-2 — `max_date`, `amount` (company currency), `debit_move_id`/`credit_move_id` (journal items), `full_reconcile_id`, `exchange_move_id`. 288 partials touch customer-invoice receivable lines (dates 2025-01-07 → 2026-10-01). Rebuilding each invoice receivable line's residual as `balance − Σ partials` matched Odoo's current `amount_residual` on **287/287 lines exactly** (incl. 11 with FX exchange moves). So receivables as of any past date D = Σ invoice receivable lines dated ≤ D minus partials with `max_date ≤ D` — historical DSO is feasible. Needs two new cache tables (receivable lines + partials), not built yet. Caveat: `max_date` is the later of the two matched entries' accounting dates, not when someone clicked reconcile — same basis Odoo's own as-of aged receivable uses.

**Frontend not updated yet — the current page expects mock-only fields (`ytdPct`, `dsoSeries`, …) and will render wrongly until 3b.** Don't merge 3a without 3b.

## 6l. ClickUp ↔ Odoo client mapping — backend (2026-10-05)

User priority after 3a: client mapping before the dashboard frontend, since it makes every future ClickUp/Odoo metric reliable. Decisions (user, 2026-10-05): link through portal `clients` with a link table (not a column, not a direct ClickUp-deal↔Odoo table); reviewers ceo + admin + operations. ADR-0013 §4/§8/§9 amended.

**Built (uncommitted, `feature/odoo-integration`):**
- Migration 032 edited (never applied to a real DB) to drop the planned `clients.odoo_partner_id`; new migration `033_create_client_odoo_mapping.js`: `odoo_partners` (cache) + `client_odoo_partner_links` (`linked`/`rejected`, `decided_by` FK users, partial unique index = one client per partner, `UNIQUE(client_id, odoo_partner_id)`, FK clients `ON DELETE RESTRICT`).
- Sync: `res.partner` pass after invoices on every run — re-reads the partner ids the invoice cache references (incl. archived), drops unreferenced ones, empty-answer guard; own `odoo_sync_state` row.
- `finance/services/clientMatcher.js` (pure): normalized-name match (legal suffixes, punctuation, accents, `.com` stripped) + company-domain match (website host / email domain; free-mail, social, shorteners and `theceas.com` ignored); rejected pairs suppressed.
- `finance/services/clientMappingService.js`: `getOverview` (summary, every cached Odoo customer with status linked/suggested/unmatched, entities, invoice count, suggestions; active clients for manual linking), `link`, `reject` (also unlink), `createClientFromPartner` (refuses if an active client has the same normalized name; client insert + link in one transaction). Role re-checked in the service; every change audited (`client_odoo_link.link/.reject/.unlink`, `client.create_from_odoo`); no-op repeats don't audit.
- Routes (`finance/routes/index.js`, mounted via management router): `GET /api/finance/client-mapping`, `POST …/links`, `POST …/rejections`, `POST …/clients` — `requireRole(USER_MANAGER_ROLES)`. `finance/errors.js` (`FinanceError`).

**Verified (fresh scratch DB copy, live full sync 335/1,188/84 partners, server on :3099):** 16 suggested / 68 unmatched of 84 Odoo customers (one false match — CEAS staff email on a client — removed by ignoring `theceas.com`); 401 no token, 403 employee, 200 operations/ceo/admin; link, idempotent re-link, 409 partner-already-linked, 400 bad ids, 404 missing client/partner, 403 employee write; reject drops the suggestion; two duplicate Odoo partners linked to one client; unlink → re-link; create-from-Odoo 201 (clients 174→175), 409 on repeat and on an existing same-name client; audit rows match actions. Real `server/data/app.db` untouched.

**Review UI (2026-10-05):** user asked for entry buttons on the CEO dashboard, Margin Planner and Commercial Lead, with the screen's location left to UI/UX judgement → its **own page, `/client-mapping`** (`modules/management/finance/views/`, served from `src/index.js`, inline scripts added to the CSP hash list). Rationale: reached from three tools, so it belongs to none of them; a `?from=ceo|planner|commercial-lead` param (whitelisted) drives a "← Back to …" header link. Own `apiClient.js`/`theme.js`/`dom.js` per the one-client-per-surface rule (frontend-architecture §3). Layout: status filter (Needs review / Unmatched / Linked / All with counts) + search; one row per Odoo customer — left: name, entity chips, posted-invoice count + last date, contact; right: suggestions with reason and Link / Not a match, "Link a different client…" picker (native datalist type-ahead), Create portal client, or linked client with inline Unlink confirm (no native dialogs). Each write reloads the overview and toasts. Entry buttons: Planner header (shown for `USER_MANAGER_ROLES` only, like its Commercial Lead button), Commercial Lead header, CEO dashboard header (both pages' audiences are already mapping roles).

**Verified in Chrome (scratch DB, :3099, admin):** Planner + Commercial Lead buttons visible and open the page with the right back link; Link (suggestion) → toast, counts 14→13 / 4→5; inline unlink confirm + cancel; picker error for an unknown name; picker + Enter links. **Not verified:** CEO dashboard button visually — that page currently fails to render because its frontend still expects sample-only fields (3a, fixed by 3b); phone-width layout (browser window resize didn't apply — breakpoint CSS present, unchecked).

**CEO dashboard crash fix (2026-10-05, before 3b):** user hit "values is not iterable" on `/ceo` in local dev. Causes: (1) revenue/collections tiles drew sparklines from sample-only `marginSeries`/`dsoSeries`; (2) a 3a bug — LWM's sample funnel/launch/content fields lived inside its mock `revenue` object and were dropped when revenue went live, while Pipeline/Delivery/People/Strategic still read them. Fixes: service carries those fields as `programs` (still sample); `render.js` reads `programsOf(e)`; revenue tiles render from the live shape (no-target copy, real month label, concentration tile for any entity with Odoo-named top client, escaped); new `renderLiveCollections` (5 aging buckets, null-safe DSO and collection rate, no fake DSO trend, overdue table with salesperson/invoices instead of ClickUp live projects, no-payment-term note); empty mix/funnel figure hidden. Chrome-verified on scratch DB: Ceas Comm / LWM / Consolidated render, zero JS errors, CEO-dashboard "Client mapping" button now visible. Real `app.db` confirmed migrated with the edited 032 (no `clients` column) + 033, first sync done (335 invoices / 84 partners). Local dev server must be restarted for the backend part.

## 6m. Odoo build step 3b + client grouping (2026-10-05)

**Built (uncommitted):**
- **Group by linked client (finance):** `financeMetricsService` resolves each Odoo customer to its linked portal client (`client_odoo_partner_links` joined to `clients`, read on every call) and groups top clients, concentration and overdue detail by it; unlinked customers stay keyed by Odoo customer. Duplicate Odoo records for one client now add up (FZE: two Paradaim records → "Bean Bazaar" AED 19,198 vs 11,374 for one alone). Rows carry `clientId` / `linked`.
- **Dashboard (3b):** "Ceas Comm FZE" tab; amounts follow the entity's currency (`amt()`/`setCurrency` in charts.js, replaces hard-coded EGP — AED on FZE); per-section "Live · Odoo" / "Sample data" labels; banner rewritten ("Partly live…"); entities with no sample data (FZE) show only Revenue + Collections; brief hidden when none; ClickUp sync line marked "sample, not connected yet", failed Odoo sync shows a red dot; "Monthly revenue" title when no target; negative months (FZE Aug, credit notes > invoices) drawn at 0 with the real value in tooltip/table.

**Verified in Chrome (scratch DB):** all 4 tabs render with 0 JS errors and correct labels (FZE AED 440K YTD, 31.1% concentration warning; LWM EGP 1.48M; Ceas Comm EGP 4.89M; Consolidated sample). Link change reflects immediately: unlinking one Paradaim record split Bean Bazaar back into two rows on the FZE snapshot; relinking merged them again.

**Next:** item 3 — commit + push branch, PR, set `ODOO_URL`/`ODOO_DB`/`ODOO_API_KEY` on Render, deploy (needs user go-ahead). Then 3c Consolidated/FX, client-mapping review (business task), Commercial Lead per-client Odoo figures. Historical DSO tables when wanted.

## 6n. CEO Control Room replaces the CEO dashboard — phase 1 (2026-10-05)

User supplied `ceas-control-room.html` (single-file prototype: 10 pages, 28-KPI weighted health score, entity switch, year compare, drill drawer, ⌘K, editable targets/budgets/function plans/decision queue — all data invented, all edits in-memory). Plan agreed: replace the CEO dashboard; phase 1 = port as-is on sample data, phase 2 = wire what's already real (Odoo revenue/collections, ClickUp pipeline, employees/leave), phase 3 = persist edits (tables + audit), phase 4 = wider Odoo sync (bank, vendor bills, P&L lines, SOs), phase 5 = ClickUp delivery/time, phase 6 = closed years.

**Phase 1 built (uncommitted, on top of the 3b work):**
- `/ceo` now serves the Control Room (`ceo-dashboard/views/`). Old dashboard frontend moved to `ceo-dashboard/views-legacy/` (not served) so the uncommitted 3b live-revenue wiring survives for phase 2; delete it once ported.
- Prototype JS split mechanically into ES modules (`util`, `model`, `charts`, `components`, `pages`, `shell`, `events` + hand-written `main`, `data`, `session`, `theme`, `apiClient`); imports generated from real references, code otherwise verbatim. CSP: no inline handlers (2 `onclick`s replaced), only the theme pre-paint inline script (auto-hashed). IBM Plex self-hosted from `views/fonts/` (OFL) — no Google Fonts allow-list.
- Data: `GET /api/ceo-dashboard/control-room` (ceo/admin, `requireRole`) → `{ controlRoom }`, served from `repositories/controlRoomSampleRepository.js` reading `repositories/data/controlRoomSample.json` (the prototype's `D`, verbatim). Old `/snapshot` + `/brief` routes untouched, unused by the UI until phase 2 folds them in.
- Portal integration: login gate + role check, shared account menu (portal tokens aliased in its scope), theme chip goes through the portal's persisted `setTheme`, rail mark → home, "Client mapping" in the rail footer, permanent "Sample data" banner + sync chip.

**Verified in Chrome (local dev, real app.db):** all 10 pages, Budget both modes, Egypt/UAE/Combined, closed year 2025 + compare, drill drawer open/close, ⌘K, target/plan/decision edits, brand/calm, light/dark/system, account menu, 400px phone layout — 0 JS errors, 0 CSP violations, all 7 font faces load. Unauthenticated API call → 401.

**Known, deferred to phase 2:** live revenue/collections no longer visible on `/ceo` (they were on the old page); prototype hard-codes "2026"/"5 Oct" in narrative copy and the current-year check; URL hash isn't re-read on back/forward; string fields interpolated into HTML need an escaping audit before Odoo partner names flow in.

### Phase 2 — wire what's already real (2026-10-05, uncommitted)

**Server.** `GET /api/ceo-dashboard/control-room?entity=ceas|fze|lwm|all` (authenticate → 401; requireRole ceo/admin → 403; unknown entity → 400; controller has explicit try/catch → next). New `ceo-dashboard/services/controlRoomService.js` clones the sample and overlays each live source through its owner's public interface, recording `sources` (`odoo`/`clickup`/`portal`/`planner`/`sample`/`error`); a failing source logs and stays sample instead of failing the page.
- **Finance (Odoo, per company):** invoiced revenue by month + YTD, trailing-90 client book (grouped by linked portal client), receivables, 5-bucket aging, DSO, >60-day share, collection rate MTD, drill records. KPI `revenue_total` renamed **"Invoiced revenue"** — the paid-SO revenue definition isn't built. Targets on live KPIs only where ADR-0013 carries one (DSO 55d, collection 85%); others "no target set". Sample sparklines and prior-year values removed for live KPIs. Consolidated stays sample until 3c FX.
- **Pipeline (ClickUp):** new `commercial-leads` read interface `getPipelineSummary()` (exported from its container): open deals by funnel bucket (bucketService mapping) + current and previous quarter cohort rows via the existing `getQuarterlyKpis` (ADR-0010 — no new conversion definition) + stage durations. Counts only (Project Value is on ~7% of deals). Win rate / coverage / avg deal / sales cycle stay sample: the prototype's "won ÷ (won + lost)" would count unqualified leads as lost — needs a business definition.
- **People (employees):** new interface `getWorkforceSummary({ today })` (employees container → `services/workforceSummaryService.js`, two new repo queries). Aggregates only, no names or pay: active headcount (roster + login active), freelancers, by department, joiners YTD, distinct employees on approved leave in the next 14 days (excluding wfh/excuse/public_holiday).
- **Costs (Margin Planner, Ceas Comm only):** `marginPlannerSummary.getCompanyCostSummary()` — burn, payroll, fixed, overhead/hr with deep links to the Planner.
- **Removed:** old `/snapshot` + `/brief` routes, `ceoDashboardService.js`, `mockSnapshotRepository.js`, `views-legacy/` (its live wiring is superseded by the above).

**Frontend.** Entity switch = Ceas Comm / FZE / LWM / All (one cached payload per entity; failed fetch keeps the previous entity). P&L / balance sheet / cash statements always render the agency-wide sample (entity-alone branches removed). "Live · <source>" badges on live panels and LIVE tags on live KPIs; banner now "Partly live". Clients, Money (cost base + receivables; payables sample), Growth (open deals by stage + cohorts), People (headcount, away, by department) have live versions. Null-safe KPI rendering (no actual / no target → "—" / "no target set"). Sync chip shows Odoo's last sync (red dot on failure). Back/forward re-reads the hash. Top bar fits one line at laptop width. Escaping checked on every live string path (client/AM/department/category names).

**Prototype bugs fixed on the way:** drill-drawer records table collapsed to 0px (flex shrink); Budget master view printed "null%" for an untracked function.

**Verified in Chrome (local dev, real app.db):** all 10 pages × 4 entities with no JS errors and no "undefined"/"NaN"/"null" text; live badges where expected (none on Clients/Money under All); FZE in AED (440K YTD, collection rate "—" with no billing this month); Ceas Comm EGP 4.89M YTD, DSO 42d (634,035 ÷ 1,343,049 × 90 — FZE's 42d checked separately, 41.6), drill records render; bad entity → 400; removed route → 404; back/forward. Service also exercised directly on a scratch DB copy for all entities. Not re-checked: phone width (layout code unchanged apart from new panels using existing components).

**Still sample / open:** health score composite, P&L, cash, balance sheet, budgets, delivery, strategic, decisions, risks, renewals, revenue at risk, utilisation/attrition/time-to-fill, pipeline money KPIs. Prototype narrative text still references its fictional agency and "5 October"; current-year check still hard-coded to 2026. Local planner payroll shows EGP 0 (local data has no salaries).

### Budget-only access for operations + people_culture (2026-10-05, uncommitted, branch feature/ceo-control-room)

User decisions (2026-10-05): ops + P&C see **only** the Budget tab; each edits only the plan of the function it owns; annual P&L-line budgets ceo/admin only. Budget/target/plan records will be seeded from the prototype's numbers in phase 3; decision queue + risk register stay sample (a future AI layer will generate briefs/risks/suggestions); cross-company client book shows EGP and AED separately.

- **Server, per route:** `GET /api/ceo-dashboard/control-room` → authenticate (401) + ceo/admin (403 otherwise), unchanged. **New** `GET /api/ceo-dashboard/budget` → authenticate (401) + ceo/admin/operations/people_culture (403 otherwise); returns only the Budget tab's blocks (budget, function plans, project budgets, the net-profit KPI) — no revenue, clients book, cash, people or sync data. Edits aren't saved yet, so there is no write route to gate until phase 3, which must enforce the same ownership rule server-side.
- **Frontend:** role → scope (`full` / `budget`). Budget scope: rail and search show Budget only, no mobile tab bar, entity/year/compare/sync controls hidden, any other hash or shortcut falls back to `#budget` (URL corrected). Function ownership: P&C → People & Culture + Hiring, Operations → Operations; Marketing has no owning role (ceo/admin). Non-owned plan cells and the P&L-line budget inputs render read-only; Operations opens on its own function. Employees-page header button reads "Budget" for these roles and opens `/ceo#budget`.
- **Verified** on a scratch DB copy (server on 127.0.0.1:3098, throwaway users in the copy only): curl — operations/P&C budget 200 / control-room 403, ceo 200/200, employee 403/403, no token 401. Browser as each role: ops edits only Operations (144 cells), P&C only People & Culture (60) + Hiring (108), CEO everything (+6 P&L inputs, Set-a-budget panel); `#money`/`#clients`/`#risks`, keys 3/f all stay on Budget; 0 JS errors after fixing an unguarded receivables read in `draw()`. Real local session unaffected.

### B. Cross-company client book + client drawer (2026-10-05, uncommitted, branch feature/ceo-control-room)

- **Rows:** every portal client (174 — each is a Commercial Lead deal record, so many are leads) plus every Odoo customer not linked to one (76 locally, because no links exist in the local DB yet). Type, default "Clients": **client** = invoiced in Odoo, or a deal onboarding / in progress / won / `complete`, or on Active Clients; **lost** = never invoiced and every deal lost; **prospect** = the rest. Local counts: 100 / 39 / 111.
- **Server, per route:** `GET /api/ceo-dashboard/clients` and `GET /api/ceo-dashboard/clients/:key` → authenticate (401) + ceo/admin (403 for operations, people_culture, employee — verified). Query values whitelisted (search ≤100 chars, company, type, link, overdue, sort, currency EGP|AED, dir, page, pageSize 10/25/50/100) → 400 otherwise; key `client:<id>|partner:<id>` → 400 malformed, 404 unknown. Filtering/sorting/paging server-side.
- **New read interfaces:** finance `customerLedgerService` (per-customer per-company invoiced YTD/all-time, open, overdue, last invoice, salesperson; detail = Odoo partners, posted invoices + credit notes, customer payments) — EGP/AED never summed; commercial-leads `getClientDeals`/`getDealsForClient`; `ceo-dashboard/services/clientTasksService` — live ClickUp tasks via the workspace-wide "Client Name" dropdown (field 691263ea-…; one filtered team query, ≤300 tasks, options cached 10 min, tasks 2 min). Matching is by name (no ClickUp id stored): 57/174 portal clients match an option; Odoo customer names are tried too. A ClickUp failure degrades the drawer's task block, not the drawer.
- **Frontend (`views/js/clientBook.js`):** panel under the Clients KPI strip, independent of the entity switch — search (debounced), company, Odoo-link, has-overdue, type tabs with counts, sort (incl. per-currency), header-click sort, pager with page size. Row click / Enter → wide drawer: profile, link-to-mapping prompt for unlinked/Odoo-only rows, per-company Odoo summary, invoices, payments, deals (links to ClickUp), tasks (open/closed/all, per-list counts, overdue due dates red, links to ClickUp built from task id). Replaces the per-entity client book.
- **Verified on local app.db (Chrome):** paging 1–25/26–50 of 100, search, type tabs, FZE filter (19), AED sort, overdue filter (6), Juno Babies portal row → 1 deal + 177 live tasks (37 open, 12 lists), Odoo-only row → 6 invoices / 7 payments + same tasks via partner name, Lightix → no-match message, KPI drawer back to normal width, 0 JS errors. Not verified: phone width (window resize didn't apply).
- **Known:** until clients are linked on the mapping page, a client can appear twice (portal row + Odoo row) — the rows say so and link to mapping.

### B2. Clients = ClickUp "Client Name" dropdown (2026-10-05/06, uncommitted, branch feature/ceo-control-room)

Recorded 2026-10-06 — built last session, which ended before the tracker was updated.

- **Decision:** a portal client is an option of ClickUp's workspace-wide "Client Name" dropdown, stored by option id (renames in ClickUp keep the link). Replaces name-matching in the drawer.
- **Migration 034** (additive): `clients.clickup_option_id` (partial unique index), `kind` client|lead, `is_internal`, `source` clickup|deal_import|odoo; `clickup_client_sync_state` single-row status table. Nothing deleted: unmatched import rows become `lead` (hidden), options removed from ClickUp → `inactive`.
- **New `management/clients` sub-module:** `clickupClientSyncService` (one GET of the field; create / attach exact-name import row / rename / deactivate / mark lead / link unlinked deals by their own Client Name via commercial-leads' public `linkDealsByClientName`; one transaction; audit `clients.clickup_sync` when anything changed; refuses an empty option list). Triggers share one in-flight guard + 60 s throttle: every 30 min, startup, page load. `POST /api/clients/clickup-sync` → authenticate (401) + USER_MANAGER_ROLES (403). Dry-run script `server/scripts/clients/clickup-client-sync-report.js [--names]`.
- **Client book / drawer:** finance `clientRepository` reads only real clients (`kind='client' AND is_internal=0`); drawer tasks fetched by stored option id (`getTasksForOption`) — clients without an option show "no match".
- **Client mapping page:** "Link same-name pairs" bulk action (`POST /api/finance/client-mapping/links/exact-names`, server recomputes the pairs, one audit entry per link, rejected pairs skipped); page triggers the ClickUp sync on load and reloads if it changed anything; copy says "client", not "portal client".
- **Local state (2026-10-06):** migration applied; last scheduled sync 08:00Z ok. Clients: 124 created from ClickUp + 57 import rows attached + 3 internal; 117 import rows → lead; 46 deals still unlinked (no Client Name set).

## 6o. Control Room — task board (updated 2026-10-06)

| # | Item | Status |
|---|---|---|
| 1 | Phase 1 — port prototype on sample data | ✅ committed 7a36369 |
| 2 | Phase 2 — wire live Odoo / ClickUp / roster / planner | ✅ committed 7a36369 |
| A | Budget-only view for operations + P&C | ✅ committed a33550b, pushed |
| B | Cross-company client book + drawer | ✅ committed be7b5db |
| B2.1 | Clients from ClickUp dropdown — backend, migration 034, sync job | 🟡 built, sync verified running locally; uncommitted |
| B2.2 | Client book (`/ceo` Clients) calls `POST /api/clients/clickup-sync` on load like the mapping page | ✅ 2026-10-06 — `clientBook.js` fires it once per page visit alongside the first book load (doesn't delay it), reloads the book if the sync changed anything, shows a one-line note if the check failed. Verified in Chrome: 1 sync call (200), not repeated on Money→Clients navigation, 25 rows, 0 JS errors; no-token call → 401 |
| B2.3 | Browser check: client book counts, drawer tasks by option id, mapping bulk link, 401/403 on the new routes | ✅ 2026-10-06 — on a scratch DB copy with throwaway users (deleted after): **access** — `POST /api/clients/clickup-sync` none 401 / employee 403 / P&C 403 / ops·admin·ceo 200; `GET /api/ceo-dashboard/clients` 200 only ceo/admin (ops 403); mapping GET + bulk POST 401/403 for none/employee/P&C. **Drawer** — Juno Babies (client 68) → `ok`, 177 tasks via stored option id; Odoo-only partner → `no_match`; internal (Ceas Figures) and lead rows (e.g. Lightix) absent from the book. **Bulk link** — 41 pairs linked, 41 audit rows, a request body with injected pairs ignored (server recomputes), re-run links 0, Odoo-only rows 76→40. 36/41 identical ignoring case; 5 differ only by punctuation/accent/suffix (Men-tell Men, Multi M Group, Replit Inc., yole egypt, Yole Saudi) — all the same company. Banner copy fixed: no longer says "exactly the same name". UI checked in Chrome on the real local DB (review list renders, Cancel — nothing linked, 0 JS errors). |
| B2.4 | Review `looseCandidates` from the dry-run script (business task — near-name import rows) | ✅ 2026-10-06 locally: 0 pending changes, 0 loose candidates. Re-run against production after deploy (prod data may differ) |
| B2.6 | User decisions 2026-10-06: (a) operations sees the client book; (b) the four CEAS companies — Ceas Comm, Ceas Comm FZE, Ceas Figures, Learn with Marie — are companies, never clients, and are the labels for which company a client is serviced from (a client can belong to several); (c) client book shows 10 rows by default | ✅ 2026-10-06 — (a) `GET /api/ceo-dashboard/clients` + `/clients/:key` gate → ceo/admin/operations (`requireClientBookViewer`); frontend scope `budget` renamed `limited`, per-role `LIMITED_PAGES` (operations: Budget + Clients, where Clients shows the book alone — no revenue KPIs/charts; people_culture: Budget), Client mapping in the rail, phone tab bar when >1 page, banner mentions the live client book, Employees header button reads "Budget & clients" for operations. (b) "Learn with Marie" added to `INTERNAL_CLIENT_NAMES` (next sync flags it, verified); company labels/filter now full names (Ceas Comm / Ceas Comm FZE / Learn with Marie). (c) default page size 10 (client + server). **Verified:** curl on scratch copy — operations book/detail/budget 200, control-room 403; P&C budget 200, book 403; employee 403; none 401. Chrome as a throwaway operations user (scratch copy, deleted after): rail Budget + Clients, book alone, 10 rows "1–10 of 104", drawer opens, `#money` stays on an allowed page, 0 JS errors. Chrome as CEO on the real local DB: all 10 pages, KPI strip intact, 0 JS errors. |
| B2.7 | Ceas Figures as a company label: not one of the integration's Odoo companies (only Ceas Comm 1, FZE 2, LWM 2268; Et3alemha id 3 not accessible) — needs the source of "serviced by Ceas Figures" | ⬜ question for user |
| B2.5 | Commit + push B2 (ask first) | ✅ 2026-10-06 — user asked; committed with B2.6 + the §6p plan to feature/ceo-control-room and pushed |
| C | Phase 3 — persist budgets, function plans, targets, custom KPIs, routing prefs | ✅ 2026-10-06 (committed, not pushed; user decisions: budgets first; targets start empty everywhere). Decision queue + risk register stay sample by decision |
| C.1 | Budgets + function plans saved, ownership enforced server-side | ✅ 2026-10-06 — see "Phase 3.1" below |
| C.2 | KPI targets + custom KPIs saved per view (Ceas Comm / FZE / LWM / All), starting empty | ✅ 2026-10-06 — see "Phase 3.2" below |
| C.3 | Escalation routing + sign-off threshold saved | ✅ 2026-10-06 — see "Phase 3.3" below |
| 4 | Phase 4 — wider Odoo sync (bank, vendor bills, P&L lines, SOs) | ✅ 2026-10-06 — done through the §6p steps 1–4 |
| 5 | Phase 5 — ClickUp delivery / time | ⬜ |
| 6 | Phase 6 — closed years | ✅ 2026-10-06 — see "Phase 6" below (committed, not pushed) |
| — | Blocked on business definitions: "lost" (win rate/coverage/sales cycle), paid-SO revenue, Consolidated FX (3c) | ⏸ |
| — | Stays sample by decision: decision queue, risk register (future AI layer) | ⏸ |
| — | Cleanup: prototype narrative copy ("5 October", fictional agency), hard-coded 2026 current-year check; phone-width check of client book | ⬜ |

## 6p. Odoo Dashboards app → Control Room mapping (PROPOSED 2026-10-06 — awaiting user approval)

Read from Odoo's own dashboard definitions (`spreadsheet.dashboard`, read-only API): every scorecard's model, filter and formula, so the Control Room can use the **same definitions** as Odoo. Data presence checked per company (2026): sales orders yes; vendor bills 187/137/2; journal items 1811/853/50; hr.expense 90/4/0; subscriptions 1 active; timesheets 5 lines; payslips 0.

| Step | Odoo source (dashboard) | Control Room place | Needs |
|---|---|---|---|
| 1 | Invoiced = posted invoices − credit notes, untaxed (Invoicing) | Already live: `revenue_total`, Clients "Invoiced revenue by month" — same definition | rename to "Revenue" if confirmed as THE revenue |
| 1 | Average invoice + invoice count; Top invoices (Invoicing) | Clients page — stat line + "Largest invoices" panel | nothing new (synced headers) |
| 1 | Invoiced by salesperson (Invoicing) | Growth — "Revenue by account manager" | nothing new |
| 2 | Quotations draft/sent count + value; Orders; Revenue (confirmed SO, untaxed); Average order; top quotations/orders (Sales) | Growth — "Open quotations" panel; KPI `avg_deal_size` (live); Money "Sales against target" bookings; KPI `backlog` = confirmed, not yet invoiced | sync `sale.order` |
| 2 | Best sellers by revenue/units, best category (Product) | Growth — "What's selling" (ordered by service) | sync `sale.order.line` |
| 3 | Income, cost of revenue, gross profit, expenses, net profit (Accounting) | Money "Income statement"; KPIs `gross_margin`, `net_profit`, `net_margin`, `opex_ratio`; Year review | sync `account.move.line` balances by account type (phase 4) |
| 3 | Cash received / spent / surplus, closing bank balance (Accounting) | Money "Cash bridge"; KPIs `cash_balance`, `cash_runway` | same + decision on which bank accounts are business cash |
| 3 | Receivables, payables, creditor days, short-term cash forecast, balance sheet ratios (Accounting, Benchmark) | Money "Payables", "Working capital", "Balance sheet" | same |
| 3 | Invoiced by product/category (Invoicing) | Clients — "Revenue by service"; later revenue side of Delivery "Margin by service line" | invoice lines |
| 4 | Expenses to report / validate / reimburse (Expenses) | Money "Payables" (owed to staff) | sync `hr.expense` |
| — | Subscriptions/MRR, Timesheets, Payroll, Project | **Not used** — almost no data in Odoo (1 subscription, 5 timesheet lines, 0 payslips) | — |

Keep portal definitions where better: DSO (trailing-90 vs Odoo's yearly balance ratio), open receivables (residual incl. partial payments vs Odoo "unpaid" = fully-unpaid only).

**Step 1 — DONE 2026-10-06 (committed on feature/ceo-control-room; previous rollback point 4574210).** Per company (Ceas Comm / FZE / LWM), year to date, same definitions as Odoo Dashboards → Finance → Invoicing with Period = this year:
- KPI `revenue_total` renamed **"Revenue"** (Money / Clients / Focus cards); query/formula text now cites the Odoo source and the 2026-10-06 decision.
- Clients page: **"Revenue by month"** (was "Invoiced revenue by month") + an **Average invoice** line (YTD revenue ÷ posted invoices and credit notes, Odoo's "Average Invoice"); new **"Largest invoices"** panel (Odoo's "Top Invoices": posted invoices, ordered by amount incl. VAT, showing untaxed; status Paid / In payment / Partly paid / Unpaid; row → client drawer), paged 4 per page (user request) in an equal-height row with "Revenue by month" (`.cols.eq`; short last page padded so the row height doesn't jump; page resets on company switch). Verified: Ceas Comm row 382px on all 3 pages, FZE/LWM panels equal. Revenue at risk now full width when live.
- Growth page: new **"Revenue by account manager"** (Odoo's "Top Salespeople": untaxed, net of credit notes, by the invoice's salesperson; share of YTD; invoice count). Under "All": a "pick a company" note.
- Server: `odooInvoiceRepository.countPosted / listLargestInvoices / sumUntaxedBySalesperson`; `financeMetricsService.buildRevenue` returns `documentCount`, `averageInvoice`, `largestInvoices`, `bySalesperson`; `toInvoice` carries `partnerName`. Fix: `listLinkedWithClientNames` only returns real clients (kind client, not internal), so finance never groups under a hidden lead row — matches the client book and avoids a drawer 404.
- Verified (local, real app.db, Chrome as CEO): Ceas Comm EGP 4,681,565 YTD / 77 docs / avg 60,800 (= 4,654,659.71 + INV/2026/00079 19,763 + 00080 7,142 posted today); FZE AED 469,965 / 35 / 13,428 (AM shares sum to YTD); LWM EGP 1,504,700 / 13 / 115,746; largest-invoice row → drawer opens; 0 JS errors.
- **"All companies" revenue — DONE 2026-10-06.** Odoo's Dashboards page rendered blank in Chrome, so the figure was read through the API instead: Odoo's Invoices Analysis (`account.invoice.report`, the model behind the Invoicing dashboard's "Invoiced" card) read with all three companies allowed and **Ceas Comm first** returns each line already converted into EGP by Odoo. 2026: **12,880,922.97 LE** (Ceas Comm 4,681,564.71 + FZE 6,694,658.26 [AED 469,963.83 at ≈ Odoo's current rate] + LWM 1,504,700.00). Note Odoo has two different all-company figures: Invoicing converts at ≈ current rate (12.88M), Profit and Loss at the year-average rate (12.27M) — revenue follows Invoicing (decision 1).
  - Migration **035** `odoo_invoice_report_lines` (one row per invoice line; converted untaxed amount; product, category, salesperson kept for step 3's revenue by service). The Odoo sync re-reads the report on every run (incremental and full) and **replaces** the table, because the conversion moves with Odoo's rates; empty answer never wipes the cache; own `odoo_sync_state` row `account.invoice.report`. `CONSOLIDATION_COMPANY_IDS` (Ceas Comm first) + `CONSOLIDATION_CURRENCY` in finance constants. A line's `currency_id` is the invoice's own currency (SAR/USD invoices exist), not the converted one — not used.
  - `financeMetricsService.getConsolidatedRevenue()`; Control Room entity **All**: Revenue KPI live (EGP 12.9M), Revenue by month, Average invoice (EGP 103,047 over 125 documents = 77 + 35 + 13), Largest invoices ranked by Odoo's converted amount with the company on each row, Revenue by account manager. Receivables / DSO / collections stay sample under All (they exist per company only). Sample drill records for revenue removed under All.
  - Column chart now draws **negative months** below a zero line in red: under All, August 2026 nets −338,779 LE because FZE reversed INV/2026/00022 (NOBLES, AED 119,539.88, "Postponed") with credit note RINV/2026/00001 on 2026-08-24. Charts without negatives unchanged.
  - Verified in Chrome (real local DB): All 12.9M / 125 docs / avg 103,047, panels equal height (508px), drawer opens from an All-companies invoice row, Ceas Comm axis unchanged, 0 JS errors.

**Both all-companies revenue figures shown — DONE 2026-10-06 (user request).** Under **All**: the Revenue card's second line reads "Odoo P&L EGP 12.3M" (hover explains), and "Revenue by month" lists both with their Odoo location — *Invoiced, converted at about today's rate* (Invoicing dashboard, YTD, the figure used) and *Odoo Profit and Loss revenue, 2026* (AED at the year-average rate, includes income posted outside invoices).
- Migration **036**: `odoo_pnl_lines` (posted journal items on the 7 P&L account types, this year + last, per company in its own currency; ~1,261 lines) and `odoo_currency_rates` (Odoo's AED rates as Ceas Comm records them). Both replaced on every Odoo sync (own sync-state row `account.move.line (P&L)`); empty answer never wipes. These are also step 3's income-statement inputs.
- `financeMetricsService.getConsolidatedPnlRevenue(year)`: −income per company; AED × `periodAverageRate` (daily average over 1 Jan–31 Dec, latest rate carried forward, days before the first rate = 1) — Odoo's method, verified to the piastre this morning (12.794048 → 12,270,007.25).
- Live value moves as Odoo adds rates: Odoo posted today's AED rate (14.24505) after the morning check, so the year average is now 12.786671 and P&L revenue **12,293,389** (also +26,905 from INV/2026/00079–80). **To confirm with the user:** Odoo's Profit and Loss, all 3 companies, 2026, should now read Revenue ≈ 12,293,389.

**Step 2 — sales orders — DONE 2026-10-06 (committed on feature/ceo-control-room).** Source: Odoo's Sales Analysis (`sale.report`, the model behind Dashboards → Sales → Sales and → Product), Period = this year by order date (Cairo).
- Migration **037** `odoo_sale_report_lines` (one row per order line, every state; amounts stored in the company's own currency AND in Odoo's all-companies EGP conversion; customer = Odoo's commercial partner, not the contact; ~606 lines, replaced every sync). Migration **038** `odoo_invoices.invoice_origin` (Odoo's Source Document).
- `financeMetricsService.getSalesSummary(entity|'all')`: quotations (draft + sent: count, value, top), booked (confirmed orders: count, value, average order, by month, top 20), backlog (untaxed still to invoice on confirmed orders, any date; top 20), products (top 10 by confirmed value), plus invoices-without-a-sales-order count.
- Control Room (each company and All): Growth KPIs **Contracted backlog** and **Average deal size** live (drills list the orders); new **Quotations this year** (largest 5, row → client drawer) and **What's selling** (bar chart by product) in an equal-height row; Money's "Sales against target" becomes **Booked and invoiced** month by month when live (no target column until phase 3). Naming: Odoo's Sales-dashboard "Revenue" = **Booked** here; Revenue stays the invoiced figure.
- Figures (2026 YTD): Ceas Comm 95 quotations (EGP 15.76M), 31 orders booked EGP 6.60M, avg 212,985, backlog EGP 4.00M; FZE 15 / AED 193,648, 19 orders AED 1.03M, avg 54,047, backlog AED 580,828; LWM 2 / EGP 940,000, 8 orders EGP 1.89M, backlog EGP 721,000; All 112 quotations EGP 19.46M, 58 orders EGP 23.12M, avg 398,641, backlog EGP 13.00M.
- **Data-quality flag (shown on Growth as a warning):** Odoo only reduces "to invoice" through invoices made from the sales order — **44 of 120 invoices this year have no sales order** (Ceas Comm 37/73, FZE 4/34, LWM 3/13), and down payments don't reduce it until the final invoice (e.g. S08786 AED 60,000 still fully "to invoice" after INV/2026/00036 for 30,000). So contracted backlog is overstated until invoicing goes through the sales order.
- Verified in Chrome (real local DB) for Ceas Comm / FZE / All: values above, warning, drills, panels equal height (461px), Money table (All: booked 23,121,152 vs invoiced 12,880,925), 0 JS errors.

**Fix 2026-10-06 — "Couldn't load this client / Odoo customer not found" from Growth → Quotations this year.** Cause: the partner sync only re-read customers that appear on invoices, so a customer that had only been quoted had no record and `getCustomerDetail` 404'd. Fix: partner sync now covers invoice **and** sales-report customers (84 → 227; sales lines sync before partners); a customer with only quotations/orders counts as found; the client drawer gains a **"Quotations and orders · Odoo"** section (each company's currency, status, to invoice) for every client, and a "Quoted, not invoiced yet" note when the customer isn't in the client book. Verified: all 32 quotation rows across Ceas Comm / FZE / LWM / All open; Chrome: MAJID AL FUTTAIM, Classera drawers render, 0 JS errors.

**Step 3a — income statement — DONE 2026-10-06 (committed).** Money → **Income statement** is now Odoo's Profit and Loss line for line (Revenue · Less Costs of Revenue · Gross Profit · Less Operating Expenses · Operating Income · Plus Other Income · Less Other Expenses · Net Profit · Less Allocations and Plus Withdrawals · Net Profit Left), from `odoo_pnl_lines` (migration 036), plus month by month (revenue, gross profit, operating expenses, net profit, net margin). One company: its own currency, beside the same span last year with the **difference in money** (a % change across a profit/loss flip is meaningless), coloured by effect on profit. All: Odoo's year-average AED conversion, no prior year (Odoo has no AED rate before Feb 2026; LWM's books start July 2025 — noted). KPIs **Gross margin, Net margin, Net profit, OPEX ratio** live from these lines (sample targets dropped; drill = monthly P&L). `financeMetricsService.getProfitAndLoss(entity|'all')`.
- 2026 so far: **Ceas Comm** revenue 4,681,565, gross margin 55.5%, operating expenses 4,078,262, **net profit −1,480,106 (−31.6%)** (2025 same span: +427,277); **FZE** AED 477,616 / net 303,679 (63.6%); **LWM** EGP 1,504,700 / net 1,501,300 (99.8% — almost no costs booked there); **All** EGP 12,293,389 / net 3,904,239. Worth raising: costs sit almost entirely in Ceas Comm while LWM/FZE carry revenue with few costs — intercompany cost allocation may be missing in Odoo.
- Verified in Chrome for Ceas Comm / FZE / LWM / All, 0 JS errors.

**Step 3b — cash + balance sheet — DONE 2026-10-06 (committed).** Per company only (Ceas Comm / FZE / LWM); under All the panels say "shown per company" — Odoo's multi-company balance-sheet conversion isn't verified and the portal never picks a rate (All's cash KPIs stay sample).
- Migration **039** `odoo_balance_lines`: every posted journal item on balance-sheet account types since each company's books began (~3,609 lines; account code/name/non-trade flag, debit, credit, balance), replaced every sync. P&L lines (036) now also read from the beginning (needed for earnings).
- Odoo's **Balance Sheet** (account.report 4) decoded and rebuilt line for line: Bank and Cash · Receivables (trade) · Current Assets (incl. non-trade receivables) · Prepayments · Fixed · Non-current · Current Liabilities (current + credit card + non-trade payables) · Payables (trade) · Non-current · Current/Previous Years Unallocated Earnings (P&L since the beginning, current year apart, net of allocations) · Current/Previous Years Retained Earnings. **All three balance** (assets = liabilities + equity); per-account bank balances equal Odoo's own `current_balance` (e.g. Credit Agricole EGP 179,050.67, Emirates NBD AED 59,584.32).
- Money: **Executive summary** (Cash / Profitability / Position today), **Cash bridge** (opening 1 Jan → received → spent → today, plus every bank/cash account), **Balance sheet**; KPIs **Cash balance** (closing bank balance, every account incl. Alex Bank (Personal) per decision 2) and **Cash runway** (portal definition: closing balance ÷ average monthly cash spent over the last 3 full months; Odoo's "cash spent" includes transfers between own accounts, so it errs short). `financeMetricsService.getBalanceSheet(entity)`.
- Figures today: **Ceas Comm** cash EGP 328,182 (1 Jan 572,590; received 9.08M, spent 9.33M), runway **0.4 months**, receivables 229,443, payables 55,441, **net assets −1,213,496**, "Current Assets" **−998,043** (credit balance on a current-asset account). **FZE** cash AED 127,751, runway 3.3 months, net assets AED 291,919. **LWM** bank **−14,250**, no cash movement in 2026 despite EGP 1.5M revenue; receivables 951,060 + current assets 818,600.
- **Bookkeeping questions for the accountant (raised to user):** Ceas Comm's −998,043 current asset and negative equity; LWM's money not reaching LWM's own bank in Odoo (collected through Ceas Comm?); costs booked in Ceas Comm while revenue sits in LWM/FZE (intercompany allocation); 44 of 120 invoices without a sales order; no January AED rate.
- Still sample on Money: **Payables** panel (vendor bills aren't synced — only the payables total is live, in the balance sheet), monthly cost base stays Margin Planner. Verified in Chrome for all four views, 0 JS errors.

**Step 4 — vendor bills + staff expenses — DONE 2026-10-06 (committed).** Per company (All: "shown per company").
- Migration **040**: `odoo_vendor_bills` (account.move in_invoice / in_refund, every state; stored bill-positive, refund-negative; 669 rows) and `odoo_expenses` (hr.expense, every state; 284 rows). Both replaced every sync.
- `financeMetricsService.getPayables(entity)`: open bills (left to pay, overdue = past due date), billed this year + top 6 vendors, expenses in Odoo's Expenses-dashboard buckets — To report (draft), To validate (submitted / reported), To reimburse (approved) — plus pending list.
- Money → **Payables** live (full-width row with Receivables when live; two inner columns): open bills, overdue, the balance sheet's Payables line beside it, staff expenses to reimburse / awaiting approval / not submitted, open bills table, billed this year by vendor.
- Figures: **Ceas Comm** 4 open bills EGP 105,700 (2 overdue, 45,700) vs balance-sheet payables 55,441; to reimburse 1,636 (2), **43 draft expenses EGP 42,314 never submitted**; billed this year 6,327,793 of which **5,172,993 (137 bills) has Ceas Comm itself as vendor** — salaries, COGS, rent booked as bills from the company to itself. **FZE** 3 open bills AED 13,589 (all overdue) vs BS 9,979; AED 130,603 billed by "Ceas Comm FZE". **LWM** no bills open; BS payables −14,250.
- Bookkeeping questions added for the accountant: internal costs booked as vendor bills with the company as its own vendor; open bills ≠ balance-sheet payables (unmatched payments/entries); 43 draft expenses at Ceas Comm.
- Verified in Chrome for Ceas Comm / FZE / LWM / All, 0 JS errors.

**User decisions 2026-10-06:** (1) revenue = **invoiced** (Invoicing dashboard: posted customer invoices − credit notes, untaxed) — replaces the 2026-10-05 "paid SO − project expenses" definition. (2) business-cash accounts: user doesn't know → proposal: show every bank/cash account exactly as Odoo's "Closing bank balance" does, listed per account, until the accountant says otherwise. (3) "All companies" figures must be **Odoo's own numbers** — no portal-chosen FX.

**Verified 2026-10-06 — Odoo's multi-company P&L method, reproduced to the piastre.** Accounting → Reporting → Profit and Loss (account.report 7) lines are sums of posted journal items by account type (income, expense_direct_cost, expense, income_other, expense_depreciation+expense_other, equity_unaffected). Each company's figures are summed in its own currency, then AED is converted at the **daily average of Odoo's AED rates over the report period** (1 Jan–31 Dec 2026; future days carry the latest rate; days before the first stored rate count as 1 — Odoo has no AED rate before 2026-02-01) = 12.794048. Rebuilt: Revenue 12,270,007.24 (Odoo .25), Cost of revenue 3,069,541.94, Operating expenses 5,311,391.03, Allocations 298,934.70 — all equal. Per company 2026: Ceas Comm revenue 4,654,659.71 EGP, FZE 477,616.43 AED, LWM 1,504,700.00 EGP. **Data-quality flag for the accountant:** no January AED rate in Odoo → January AED counted 1:1 in consolidated reports.

Invoiced vs ledger revenue 2026: Ceas Comm 4,654,659.71 = 4,654,659.71; LWM equal; FZE invoiced 469,963.83 vs ledger 477,616.43 (7,652.60 posted to income outside invoices). The portal's Ceas Comm YTD card read 4.87M this morning because INV/2026/00073 + 00074 (219,830) were cancelled in Odoo at ~13:27 — portal now equals Odoo.

### Phase 3.1 — saved budgets and function plans (2026-10-06, committed, not pushed)

- Migration **041**: `control_room_budget_lines` (year, line, annual, seed_annual, updated_by FK users, updated_at; UNIQUE year+line) and `control_room_function_plans` (year, function, category, month 0–11, amount, seed_amount, …; UNIQUE). Seeded once for 2026 from the workbook figures the prototype carried (6 lines, 348 cells). Never deleted; amounts CHECK ≥ 0.
- `ceo-dashboard/services/budgetService.js` (+ `repositories/budgetRepository.js`): **who may change what is enforced here** — P&L-line budgets ceo/admin; function plans ceo/admin for all, people_culture for People & Culture + Hiring, operations for Operations (Marketing: ceo/admin). Whole EGP 0–9,999,999,999; note ≤ 300 chars; unknown line/cell → 404; unchanged value → no write, no audit. Every change audited (`control_room.budget_line.update` / `control_room.function_plan.update`, from/to/note).
- Routes: `PUT /api/ceo-dashboard/budget/lines/:name` (authenticate + ceo/admin) and `PUT /api/ceo-dashboard/budget/plan` (authenticate + budget viewers, then the ownership check → 403).
- Both payloads (`/control-room` and the Budget-only `/budget`) read the saved amounts (`applyBudgets`; a failed read falls back to the workbook figures and logs). Page: an edit is sent first and only shown once accepted; a refusal toasts the server's reason and puts the old value back; "edited" = changed from the workbook seed; restore / "Restore all N to the workbook" saves the seed back (audited). Banner: "every change is saved and logged".
- Verified on a scratch DB copy with throwaway users (deleted after): curl matrix — none 401, employee 403 everywhere, P&C 200 only people/hiring, operations 200 only ops, ceo 200 all; validation 400s/404s; forged functionId 400; audit rows correct. Chrome as operations: 144 editable cells, edit persists across reload, over-limit value refused with the server's message and reverted; as CEO: P&L line edit, restore-all back to workbook, 0 JS errors.

### Phase 3.2 — saved KPI targets and hand-entered KPIs (2026-10-06, committed, not pushed)

User decision 2026-10-06: **targets per view** (Ceas Comm, FZE, LWM, All — each in its own currency), **starting empty everywhere** (no prototype targets seeded).
- Migration **042**: `control_room_kpi_targets` (entity CHECK ceas|fze|lwm|all, kpi_id, target NULL = cleared, updated_by FK users; UNIQUE entity+kpi) and `control_room_custom_kpis` (entity, name, unit/direction/target_type/component CHECKed, hand-entered actual, archived flag — never deleted).
- `ceo-dashboard/services/targetService.js` (+ `targetRepository`, `unitOfWork`): **ceo/admin only, enforced server-side**; KPI id must be a registry id or an active custom KPI **of the same view**; numbers |x| < 1e12 or null; note ≤ 300; unchanged → no write. Adding a KPI with a target writes both tables in one transaction. Audited: `control_room.kpi_target.update` (from/to/note), `control_room.custom_kpi.create`, `control_room.custom_kpi.archive`.
- Routes (authenticate + ceo/admin): `PUT /api/ceo-dashboard/targets`, `POST /api/ceo-dashboard/kpis`, `POST /api/ceo-dashboard/kpis/:kpiId/archive`.
- `/control-room?entity=` applies the view's saved targets to **every** KPI after the live overlays (none saved → "no target set") and adds that view's custom KPIs.
- Page: target box saves for the current view (Enter), emptied box or × clears it; "Add a KPI" saves to the current view (target and actual optional), × archives it; in-memory carry-over of added KPIs across views removed. **Health score**: an area with no targeted scored KPI is "not scored" (not 0); composite weighs only scored areas and shows coverage ("100 / 100 · 1 of 6 areas scored"); with none → "—, set targets to score". Copy no longer claims period-versioned targets — it says what happens (saved per view, logged).
- Verified on a scratch DB copy with throwaway users (deleted after): none 401 / employee 403 / operations 403 / ceo 200|201; bad entity/unknown KPI/non-number → 400/404; custom KPI of Ceas Comm unreachable from FZE (404); audit rows correct; Chrome as CEO: empty-state health, set DSO 45 → persists across reload, × clears, FZE's 60% gross margin stays in FZE, custom NPS only in Ceas Comm; all 10 pages free of NaN/undefined; 0 JS errors.
- Not changed: the Budget-only payload (operations/P&C) keeps its net-profit card's workbook plan as before.

### Phase 3.3 — saved escalation preferences (2026-10-06, committed, not pushed)

- Migration **043**: `control_room_escalation_routes` (area PK, comes_to_ceo 0/1) seeded with the Control Room defaults (cash, collections, revenue, pipeline, strategic → CEO; delivery, people, operations → heads) and `control_room_settings` (single row, CHECK id = 1) with the sign-off threshold, seeded EGP 150,000. **Company-wide**, not per view. Updated only.
- `escalationService` (+ `escalationRepository`): ceo/admin only (server-side); area must exist (404), comesToCeo boolean, threshold whole EGP 0–9,999,999,999; unchanged → no write; audited `control_room.escalation.update` (from/to). Routes: `PUT /api/ceo-dashboard/escalation/routes/:area`, `PUT /api/ceo-dashboard/escalation/threshold` (authenticate + ceo/admin).
- `/control-room` payload carries `prefs`; the page copies them into its state on first load only (cached views may hold older copies) and saves each toggle/threshold before re-routing the queue; a refusal toasts the reason.
- Verified on a scratch DB copy (throwaway users deleted): none 401 / operations 403 / ceo 200; bad area 404, non-boolean 400, negative threshold 400; audit rows; Chrome as CEO: toggle + threshold saved, kept across a view switch and a reload, 0 JS errors.
- Phase 3 complete. Still sample by decision: decision queue, risk register (future AI layer).

### Phase 6 — closed years and year-on-year from Odoo (2026-10-06, committed, not pushed)

- `financeMetricsService.getYearHistory(entity)` — per company, each year since its Odoo books began (Ceas Comm 20 May 2024, FZE 31 Dec 2024 → first comparable year 2025, LWM 16 Jul 2025): **ytd** 1 Jan → today's date in that year (revenue = invoiced; cost of revenue, gross margin, operating expenses + ratio, net profit + margin from the P&L lines), **at** that date (cash across bank/cash/credit-card accounts, runway = cash ÷ average monthly cash spent over the 3 months before, trade receivables from the balance sheet, DSO = receivables ÷ 90 days' billing incl. VAT × 90), **full** for closed years (+ cash at 31 Dec). Rules: a year whose books begin after its comparison date is skipped; a part-year is flagged (`partialFrom`); runway on no/negative cash and DSO over 365 days → "not meaningful". No new sync — all from tables 032/036/039.
- Control Room: `applyYears` replaces the sample's invented years per company; year-review rows are only what Odoo can answer; the "vs <year>" line on KPI cards only for live KPIs with the same definition (revenue, gross/net margin, net profit, OPEX ratio, cash, runway — **not DSO**: the live card uses open invoices, history uses the balance sheet). Under **All** only the live year is offered (Odoo has no AED rate before Feb 2026). Year review rewritten: currency of the view, nulls as "—", books-start note, no invented narrative.
- **Hard-coded "2026" removed** (closed-year check, year-switch toast, year review): the live year comes from the server (`currentYear`); switching company falls back to the live year when the selected year isn't in that company's books. Money formatting in year tables uses the view's currency.
- "Partly live" banner rewritten to list exactly what is still sample.
- Figures (to 6 Oct): **Ceas Comm** 2025 revenue 2.80M / net profit 427K (15.3%) / cash 285K / DSO 45 → 2026 4.68M / −1.48M (−31.6%) / 328K / 18 (balance-sheet basis); full 2025 revenue 3.74M, net profit 296K, cash 31 Dec 573K. **FZE** 2025 AED 65K revenue, net 5K. **LWM** 2025 (from 16 Jul) EGP 204K.
- Verified in Chrome (real local DB, viewing only): Ceas Comm 2026/2025/2024 (partial), compare vs 2025 on live KPI cards, closed-year page; FZE/LWM 2026 + 2025; All 2026 only; fallback from 2024 on company switch; 0 JS errors.

## 7. Open Questions

- CEO-vs-`manager` role naming; `finance`'s dead-role status.
- Exact field-level cost/price permission design (who sees what).
- Whether the pricing↔management ADR is its own doc or folded into ADR-0013.
- Automating Margin Planner project creation off a Closed-Won deal — good idea, explicitly deferred, not scheduled yet.
- ~~Which Odoo apps are active~~ — **Resolved 2026-10-04 (§6f):** full Accounting, Sales+Subscriptions, CRM, Purchase, Expenses, Project/Timesheets, Payroll.
- ~~Personal-account permissions / key expiry~~ — **Resolved 2026-10-04 (§6f):** read access confirmed on every finance/CRM model; key is persistent.
- **New (2026-10-04):** which of the 4 Odoo companies are in the Business Portal's scope? Et3alemha (id 3) isn't visible to the integration account at all — needs either access granted or a decision that it's out of scope. Learn With Marie is visible but may not belong in CEAS reporting.
- ~~Currency rule~~ — **Answered 2026-10-04 (§6g):** support both (Odoo rates + fixed rate).
- ~~CEO-dashboard entity mapping~~ — **Answered 2026-10-04:** Ceas Comm FZE gets **its own tab** (tabs become Ceas Comm / Ceas Comm FZE / Learn with Marie / Consolidated).
- **To be implemented (not deferred) — Et3alemha:** in scope, parked for now by user decision 2026-10-04; needs Odoo access granted to the integration account first. Revisit after the first Odoo sync is live.
- ~~Pipeline source of truth~~ — **Answered 2026-10-04: ClickUp** stays the pipeline source; Odoo CRM is not synced for pipeline.
- ~~commercial/account_management on Commercial Lead~~ — **Answered 2026-10-04: no** — stays ceo/operations/admin.
- **Decided 2026-10-04:** first Odoo build target is the **CEO Dashboard** (swap mock data for real), Finance page second.
- **To be implemented (not deferred) — salary from Odoo:** feasible (§6g), parked by user decision 2026-10-04 for simplicity; portal-entered `employees.salary` stays the source for now.
