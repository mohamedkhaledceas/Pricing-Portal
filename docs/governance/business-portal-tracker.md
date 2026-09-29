# CEAS Business Portal — Implementation Tracker

Living audit + execution queue for `CeasComm_Business_Portal_Requirements.docx` (`/Users/mohamedkhaled/Documents/ceas/`, created 2026-09-24) — an 18-pillar Commercial/Finance/CEO BI portal spec, separate from the two requirement docs `docs/governance/implementation-tracker.md` already covers (HR-portal sections + governance workflow). Kept as its own file deliberately: different domain, different pillar structure, no value in forcing one file to serve both.

**Status as of 2026-09-27: 100% planning/architecture. Zero migrations written, zero code written.** Per `CLAUDE.md`'s staged process, nothing below should turn into production code until a milestone here is explicitly approved and reflected in `docs/migration-plan.md`.

**Hard external blocker:** Odoo integration (credentials not yet in `server/.env` — user has Odoo Online access at `ceas-comm1.odoo.com`, Odoo 19 Enterprise, but hasn't generated/added an API key yet). Every pillar below is tagged **Odoo-blocked** or **Odoo-free** so work can proceed on the latter while access gets sorted.

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
| 16 | Odoo Integration & Data Mapping | Not Started | **Blocked** (it's the blocker) | — |
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
10. ADR-0013 draft: Odoo integration strategy (can be drafted now on Odoo's known standard object shapes, verified once access lands).

## 5. Blocked queue (resumes when `server/.env` has real `ODOO_*` values)

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

## 7. Open Questions

- CEO-vs-`manager` role naming; `finance`'s dead-role status.
- Exact field-level cost/price permission design (who sees what).
- Whether the pricing↔management ADR is its own doc or folded into ADR-0013.
- Automating Margin Planner project creation off a Closed-Won deal — good idea, explicitly deferred, not scheduled yet.
- Which Odoo apps are actually active/used at CEAS (Accounting vs. Invoicing-only, Expenses, Purchase) — determines real scope of pillars 6–13.
