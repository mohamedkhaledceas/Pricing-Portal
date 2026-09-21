# Database

The living schema reference — rewritten to describe the database that actually exists, verified directly against `server/src/db.js` (the base inline schema) and every file in `server/src/db/migrations/` (23 migrations as of this writing), not against a plan.

**Engine: `better-sqlite3`, not PostgreSQL.** Query/migration layer: a small hand-rolled runner (`server/src/db/migrationRunner.js`), not Knex. ADR-0003 decided to move to Postgres+Knex; that decision was never carried out. WAL mode is enabled (`db.pragma('journal_mode = WAL')`). The database is one file on a mounted Render persistent disk in production (`DB_DIR/app.db`).

Treat this document the way `docs/architecture.md` now explicitly says to: as a description of what's running, kept honest by being checked against the migration files, not the other way around. When in doubt, the migration files are the real ground truth — this document summarizes them, it doesn't replace reading one when you need exact column-level detail.

---

## 1. How the schema is actually built

Two layers, in order, every time the app boots (`db.js`):

1. **Base inline schema** — a single template-literal `CREATE TABLE IF NOT EXISTS ...` block in `db.js` itself, covering the tables that existed before the migration system was introduced (the original Pricing Portal tables, plus `users`/`refresh_tokens`/`audit_log`, plus the commercial-lead cache tables added later directly here rather than via a migration).
2. **`runMigrations(db)`** — applies every numbered file in `db/migrations/` that hasn't run yet, in order, tracked in a migrations-tracking table. This is where every `employees`-module table, every KPI table, `departments`, `conflict_pairs`, and `password_reset_tokens` were added.

There is no single place that shows the "final" schema as one document outside of reading both of these — which is exactly why this file exists and needs to stay current.

---

## 2. Tables by owning module

### auth (`db.js` base schema + migration 023)

```
users
  id, email (unique), first_name, last_name, password_hash,
  role TEXT CHECK IN ('employee','manager','operations','finance','admin','people_culture'),
  is_active, uuid (migration 006 — permanent, admin-visible, per-account identifier
                    used for support/log tracing, distinct from the per-request
                    correlation ID), last_seen_at (migration 005),
  created_at, updated_at

refresh_tokens
  id, user_id -> users(id), token_hash (unique), expires_at,
  revoked_at, revoked_reason, created_at
  indexes: user_id, token_hash

password_reset_tokens        -- migration 023
  id, user_id -> users(id), token_hash, expires_at, used_at, created_at
```

No `user_module_access` table — module access was never built as a separate grantable concept; role alone gates everything (see `docs/architecture.md` §6).

### employees (migration 002 + follow-ons: 007, 008, 009, 011, 012, 021, 022)

```
employees
  id, user_id -> users(id) UNIQUE (one employee profile per login account;
                                     no name/email columns here — those live
                                     on users, keeping the auth/employees
                                     boundary real),
  clickup_user_id, department -> departments(id) (migration 011, was a free-text
                                                     column originally),
  kpi_profile TEXT CHECK IN ('content','artdirector','aidesigner','production',
                              'am','pandc','heads','design') NULLABLE,
  manager_employee_id -> employees(id) NULLABLE (self-referencing),
  is_people_culture, active (employment status — deliberately distinct from
                              users.is_active, which is login/access status;
                              the two can change independently),
  created_at, updated_at
  FKs: ON DELETE RESTRICT throughout (see §4)

leave_requests
  id, employee_id -> employees(id),
  leave_type TEXT CHECK IN ('planned','short_notice','sick','emergency',
                             'mental_health','public_holiday','wfh','excuse','unpaid'),
  start_date, end_date, half_day, half_day_period CHECK IN ('morning','afternoon') OR NULL,
  handover_employee_id -> employees(id) NULLABLE,
  reason,
  status TEXT CHECK IN ('pending','manager_approved','approved','rejected',
                         'auto_rejected','cancelled')
    -- models the real two-decision-maker flow: manager decision, then P&C
    -- confirmation; a manager rejection and a P&C rejection both just land
    -- on 'rejected' (the distinction lives in auto_reject_reason/audit_log,
    -- not a separate status)
  auto_reject_reason,
  manager_decision_by -> employees(id), manager_decision_at,
  pc_confirmed_by -> employees(id), pc_confirmed_at,
  salary_deduction TEXT CHECK IN ('none','half_day','full_day','unpaid'), unpaid_days_count,
  clickup_task_id (migration 003), doctor_note_provided (migration 022),
  created_at, updated_at
  indexes: employee_id, status

conflict_pairs
  id, employee_id_a -> employees(id), employee_id_b -> employees(id), active, created_at

departments                   -- migration 010
  id, code (unique), label, active, created_at
  -- role-managed table replacing what used to be a hardcoded department
  -- array; employees.department is a real FK into this table (migration 011)

employee_profile_change_requests   -- migration 008
  id, employee_id -> employees(id), requested_by -> users(id),
  status TEXT CHECK IN ('pending','approved','rejected'),
  field-level before/after columns, created_at, decided_at, decided_by
```

**KPI tables** (migrations 002, 013–020 — the largest single cluster of tables in the schema):

```
kpi_definitions            -- Pillar B only; Pillar A's 6 dimensions are fixed/
                               equal-weight for every role and don't need per-role
                               rows. kpi_profile, pillar CHECK IN ('quality',
                               'delivery','growth','people_retention'), weight,
                               source_type CHECK IN ('auto','semi','manual','goals','odoo')
                               -- NOTE: source_type is descriptive metadata only;
                               it does not by itself mean a metric is automated
                               (see docs/governance/implementation-tracker.md's
                               2026-09-20 entry for the live-verified detail)

kpi_scores                 -- one row per (employee, quarter, metric); source
                               mirrors kpi_definitions.source_type's enum;
                               entered_by -> employees(id)

kpi_pillar_a_reviews       -- per-employee, per-quarter Pillar A scores (the
                               anonymized peer+manager review outcome)

kpi_self_evaluations       -- migration 013; an employee's own self-rating on
                               the same 6 Pillar A dimensions — shown for
                               comparison only, never folded into the real
                               scored total

kpi_employee_targets       -- migration 015; per-employee override for the
                               handful of metrics whose target genuinely varies
                               per person; settable only by that employee's
                               manager or an admin

kpi_peer_review_responses  -- migration 019; raw per-reviewer rows behind the
                               "everyone reviews everyone" hosted peer review.
                               Anonymity is enforced by ACCESS CONTROL (no
                               controller/service ever returns reviewer_employee_id
                               in a response), not by omitting the column —
                               it's required in the schema to block duplicate
                               submissions and track completion

kpi_review_windows         -- migration 020; per-quarter, P&C/admin-configurable
                               open/close dates for the peer-review period

employee_kpi_notifications -- migration 014; in-app KPI feedback notifications,
                               deliberately scoped to this module rather than a
                               repo-wide notification framework (see ADR-0012) —
                               user_id -> users(id), since the recipient is
                               "who logs in", not an employee-domain concept

kpi_clickup_status_events  -- migration 016; one row per real ClickUp status
                               transition received over the KPI webhook, for
                               every list in the workspace, forward-only from
                               whenever this shipped (ClickUp's webhook stream
                               has no retroactive history)

kpi_auto_metric_mappings   -- migration 017; data-driven config for *how* one
                               Pillar B metric is computed from ClickUp, per
                               role, using that role's own real list/status/tag
                               names — never assumes a metric's shape matches
                               the source spreadsheet's wording

kpi_clickup_lists          -- migration 018; local cache of list/status names
                               for any list an active mapping references,
                               refreshed periodically so the mapping-admin UI
                               shows real current ClickUp statuses to pick from
```

### management / commercial-leads (`db.js` base schema — added directly there, not via a migration)

```
commercial_lead_live_cache        -- mirror of each tracked ClickUp deal's
                                      current state (2026 Projects, Active
                                      Clients, Client Offboarding lists), kept
                                      fresh by webhook events + periodic
                                      reconciliation; the portal never waits on
                                      a live ClickUp call to render

commercial_lead_stage_tracking    -- working state, one row per open deal;
                                      FK ON DELETE CASCADE to live_cache (this
                                      is a true child record, correctly not
                                      RESTRICT — see §4)

commercial_lead_stage_history     -- permanent, append-only; one row per
                                      completed stage, survives even if the
                                      live deal is later deleted from ClickUp

commercial_lead_daily_counts      -- permanent daily counts, recomputed
                                      (upserted) rather than replayed

commercial_lead_status_colors     -- PK (list_id, status); exact hex colors as
                                      currently defined in ClickUp, for
                                      consistent chart coloring

commercial_lead_bucket_events     -- permanent, append-only; one row per time a
                                      deal crosses into a reporting bucket

commercial_lead_quarter_snapshots -- one immutable row per (list, quarter),
                                      written once by the quarter-close job —
                                      the frozen, official figure a live
                                      in-quarter number is checked against
```

### management / ceo-dashboard

No dedicated tables of its own — reads are composed from `commercial_lead_*` and the pricing tables below (its "Prototype with mocked data" banner reflects that most of what it displays is illustrative, not yet wired to Odoo/ClickUp — see `docs/governance/implementation-tracker.md` for current status).

### The legacy Pricing / Margin Planner tables (`db.js` base schema — pre-dates every module)

```
company_settings   (single row, id = 1)   -- company name, currency, default
                                              hours/utilization/margin targets,
                                              rates, logo
app_state          (single row, id = 1)   -- current_project, mode, a security
                                              PIN hash for the "team view" toggle
team_members       -- salaries, roles, hours, utilization
expenses           -- fixed monthly/annual costs
projects           -- id, name, client, months, status, pricing target/contingency,
                       quote_json (a JSON blob for quote metadata — not
                       normalized into its own columns)
project_lines      -- FK -> projects(id) ON DELETE CASCADE
direct_costs       -- FK -> projects(id) ON DELETE CASCADE
scenarios          -- FK -> projects(id) ON DELETE CASCADE
quote_lines        -- FK -> projects(id) ON DELETE CASCADE
```

These four child tables correctly use `ON DELETE CASCADE`, not `RESTRICT` — deleting a project legitimately should delete its own line items, direct costs, scenarios, and quote lines. This is a true parent-child composition, a different relationship shape than anything in `employees` (see §4).

### common

```
audit_log
  id, user_id -> users(id) NULLABLE, username (denormalized at write time —
                see below), action, entity_type, entity_id, details (JSON text),
  ip_address, created_at
  indexes: user_id, created_at
```

`username` is captured at the time of the action, not joined live from `users` on read — so an audit entry still shows who did something even if that user account is later deactivated or its name changes. `common/audit.js`'s `record(...)` is the only way this table is ever written to, from every module, and it also resolves and logs the actor's `users.uuid` into the structured JSON logs at the same time (see `docs/architecture.md` §5) — one audit call produces both a durable DB row and a searchable log line.

---

## 3. Indexes

No blanket "every FK gets an index" migration was run as a single pass — indexes exist where a specific query pattern needed one, added at the same time as the table (e.g. `idx_employees_manager`, `idx_leave_requests_employee`, `idx_leave_requests_status`, `idx_refresh_tokens_user_id`, `idx_refresh_tokens_token_hash`, `idx_audit_log_user_id`, `idx_audit_log_created_at`). This is narrower than "index every FK column automatically," but every index that does exist is real and was added because a real query needed it, not spread evenly by default.

---

## 4. Constraints — two different, both-correct FK deletion policies

**`employees`-module tables (and `users`/`refresh_tokens`) use `ON DELETE RESTRICT` throughout**, per this project's revoke-never-delete policy for any row with retained history (leave requests, KPI scores, audit entries). No application code path ever issues a `DELETE` against `users` or `employees` — `RESTRICT` is a defensive guarantee against that ever happening by accident, not a constraint the app actively relies on day-to-day.

**The legacy Pricing tables' child rows (`project_lines`, `direct_costs`, `scenarios`, `quote_lines`) use `ON DELETE CASCADE`**, and that's the correct choice for them — they're true compositions of a project, not independently retained history. **Commercial-lead's `stage_tracking` also cascades from `live_cache`** for the same reason (it's working state mirroring a live ClickUp deal, not a permanent record — `stage_history`/`bucket_events`/`quarter_snapshots` are the permanent, append-only tables in that same module, and correctly have no cascade relationship to the mutable cache).

Enum-like fields (`users.role`, `leave_requests.status`/`leave_type`/`salary_deduction`, `kpi_definitions.pillar`/`source_type`, `employee_profile_change_requests.status`) are `TEXT` columns with a `CHECK` constraint, not a dedicated SQLite type (SQLite has no native enum type, so this was the only real option — unlike the Postgres-targeted original document, this wasn't a choice between CHECK and a native enum). One real, documented limitation: SQLite can't add or alter a `CHECK` constraint on an existing column without a full table rebuild, which migration 008 explicitly worked around by *not* adding a `CHECK` to a couple of columns it added, rather than paying for a rebuild — worth knowing before assuming every enum-shaped column here is actually constrained at the DB level.

---

## 5. Transactions

**Real pattern**: `better-sqlite3`'s synchronous `db.transaction(fn)` — not an async Knex transaction, since `better-sqlite3` is fully synchronous. Used via a small `unitOfWork.js` repository in `auth` and in `commercial-leads`, plus directly in `index.js`'s `replaceWholeState` (the legacy Pricing multi-table write path) and in two other repositories. This is **narrower than a blanket "every multi-table write is wrapped in a transaction" rule** — it's applied at the specific points that were identified as needing it, not verified to cover every multi-statement write path in the app. If you're adding a new multi-table write, check whether it needs the same treatment rather than assuming an existing enforcement mechanism will catch a missing one.

---

## 6. Optimistic concurrency

No version-column optimistic locking anywhere. Status-guarded conditional updates (`UPDATE leave_requests SET status = 'approved' ... WHERE id = ? AND status = 'pending'`, checking the affected-row count) are the real pattern for "this write should apply exactly once, from a known prior state" — used for leave-request manager/P&C decisions. This part of the original plan was accurate to what was actually built.

---

## 7. Migrations — how to actually add one

1. Add a new numbered file to `server/src/db/migrations/` (next sequential number, `NNN_description.js`), exporting `up(db)`.
2. Write plain `db.exec(...)` / `db.prepare(...).run()` — no Knex query-builder syntax, no `.schema.createTable(...)`.
3. `runMigrations(db)` (called from `db.js` on every boot) applies any migration not yet recorded as run — there is no separate `npm run migrate` deploy step; it happens automatically on process start. This is a real difference from the original plan, which called for migrations as an explicit, non-automatic deploy step specifically to avoid a race if multiple instances started concurrently — worth being aware of if this app ever runs more than one instance at once (it doesn't today; single Render service, per `docs/architecture.md` §11).
4. Comment the *why*, not just the *what* — every existing migration in this repo does this well (see e.g. `002_create_employees_tables.js`'s or `017_create_kpi_auto_metric_mappings.js`'s header comments), and it's the reason this schema is understandable without a matching design doc for every table.

---

## 8. Related documents

- `docs/architecture.md` — the system-level rewrite this file was done alongside; §7 and §12 there cover the engine/migration-system reality and what the original plan got right vs. wrong
- `docs/governance/implementation-tracker.md` — feature-level current status; several KPI table comments above reference specific dated entries there for live-verified behavior (e.g. `source_type`'s real meaning)
- `server/src/db.js`, `server/src/db/migrations/` — the actual ground truth; read these directly for exact column lists, defaults, and every `CHECK`/index this document summarizes rather than reproduces in full
