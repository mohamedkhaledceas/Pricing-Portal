# Database

The living schema reference. Unlike `docs/architecture.md` (which explains *why* the database is shaped this way), this document is meant to stay in sync with the actual migration files in `db/migrations/` as the schema evolves — treat a schema change without a corresponding update here as incomplete.

Engine: **PostgreSQL**. Query/migration layer: **Knex.js**. See ADR-003 for the engine decision and ADR-006-adjacent reasoning for Knex over a full ORM.

---

## 1. Schema by module

### auth

```
users
  id                 serial primary key
  email              text unique not null
  password_hash      text null           -- null until a password is set (Google-only accounts)
  google_sub         text unique null    -- Google's stable subject identifier
  role               text not null check (role in ('admin','pricing_user','hr_admin','manager','employee'))
  is_active          boolean not null default true
  created_at         timestamptz not null default now()
  updated_at         timestamptz not null default now()

refresh_tokens
  id                 serial primary key
  user_id            integer not null references users(id) on delete restrict
  token_hash         text not null
  expires_at         timestamptz not null
  revoked_at         timestamptz null
  replaced_by_id      integer null references refresh_tokens(id) on delete restrict
  created_at         timestamptz not null default now()

user_module_access
  user_id            integer not null references users(id) on delete restrict
  module_code        text not null check (module_code in ('pricing','employees'))
  granted_at         timestamptz not null default now()
  primary key (user_id, module_code)
```

### employees

```
employee_roster
  id                    serial primary key
  full_name             text not null
  email                 text unique not null
  clickup_id            text unique not null
  department            text null
  location              text null          -- 'Cairo' | 'Alexandria', backlog feature, column reserved now
  manager_employee_id   integer null references employee_roster(id) on delete restrict
  active                boolean not null default true
  synced_at             timestamptz not null default now()
  user_id               integer unique null references users(id) on delete restrict

leave_requests
  id                     serial primary key
  employee_id            integer not null references employee_roster(id) on delete restrict
  type                   text not null check (type in ('pto','sick','emergency','unpaid','wfh','excuse','mental'))
  start_date             date not null
  end_date               date not null
  status                 text not null default 'pending'
    check (status in ('pending','approved','rejected','auto_rejected','canceled'))
  reason                 text null
  handover_employee_id   integer null references employee_roster(id) on delete restrict
  manager_id_snapshot    integer null references employee_roster(id) on delete restrict
  auto_reject_reason     text null
  salary_deduction_flag  text null check (salary_deduction_flag in ('none','possible','applies'))
  created_at             timestamptz not null default now()
  updated_at             timestamptz not null default now()

deductions
  id                   serial primary key
  employee_id          integer not null references employee_roster(id) on delete restrict
  leave_request_id     integer null references leave_requests(id) on delete restrict
  amount               numeric null
  reason               text not null
  flagged_by_user_id   integer not null references users(id) on delete restrict
  created_at           timestamptz not null default now()

roster_sync_log
  id               serial primary key
  started_at       timestamptz not null
  finished_at      timestamptz null
  added_count      integer not null default 0
  deactivated_count integer not null default 0
  error            text null
```

`kpi_scores` and related tables: **not yet designed.** Deferred until the KPI framework/Excel formulas are reviewed (explicit backlog item, `docs/architecture.md` §21) — the shape isn't guessed at ahead of that review.

### common

```
audit_log
  id             serial primary key
  actor_user_id  integer not null references users(id) on delete restrict
  action         text not null              -- e.g. 'leave.approved', 'user.revoked', 'salary.updated'
  target_type    text not null              -- e.g. 'leave_request', 'user', 'team_member'
  target_id      text not null
  metadata       jsonb null
  correlation_id text null
  created_at     timestamptz not null default now()
```

### pricing

Existing schema (`company_settings`, `team_members`, `expenses`, `projects`, `project_lines`, `direct_costs`, `scenarios`, `quote_lines`) — ported to Postgres types (`serial`/`text`/`numeric`/`timestamptz`), no structural redesign. The single-row `company_settings` (`id = 1`) pattern is preserved, matching the confirmed single-company scope.

---

## 2. Indexes

**Rule: every foreign key column gets an explicit index.** Postgres indexes the referenced (primary key) side of a foreign key automatically, but not the referencing side — leaving FK columns unindexed is a common, easy-to-miss production gap, and every join in this schema (roster → manager, leave request → employee, audit log → actor) depends on this.

| Table | Index |
|---|---|
| `users` | `email` (unique), `google_sub` (unique) |
| `refresh_tokens` | `token_hash`, `user_id` |
| `user_module_access` | (covered by composite PK) |
| `employee_roster` | `email` (unique), `clickup_id` (unique), `manager_employee_id`, `user_id` (unique) |
| `leave_requests` | `employee_id`, `status`, composite `(employee_id, start_date, end_date)` for overlap/clash-rule queries |
| `deductions` | `employee_id`, `leave_request_id` |
| `audit_log` | `actor_user_id`, composite `(target_type, target_id)`, `created_at` |
| pricing tables | every existing `project_id`/parent-id FK column |

---

## 3. Constraints

- **CHECK constraints on `text` columns for enum-like fields** (`role`, `leave_requests.status`, `leave_requests.type`, `module_code`, `salary_deduction_flag`) — deliberately **not** native Postgres `enum` types. A CHECK-constraint migration (`ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...`) is simpler and less disruptive than an enum-type migration (`ALTER TYPE ... ADD VALUE`, which can't run inside a transaction in older Postgres versions and can't remove values at all). Given the role model alone was revised multiple times during this project's design phase, treating these as "will need additive changes" rather than "fixed forever" is the realistic assumption.
- **Foreign keys default to `on delete restrict`.** Given the revoke-not-delete policy (`docs/architecture.md` §4.2, §6.4), nothing should be able to cascade-destroy retained history by deleting a parent row. In practice, no application code path ever issues a `DELETE` against `users` or `employee_roster` — `restrict` is a defensive guarantee against that ever happening by accident (including via a future engineer adding a delete endpoint without reading this document), not a constraint actively relied upon today.
- **`refresh_tokens.replaced_by_id`** self-references the same table (rotation chain) — also `restrict`, since the audit value of an old, rotated token is in *not* disappearing when replaced.

---

## 4. Transactions — enumerated boundaries

**Rule** (`docs/architecture.md` §6.2): any service method writing to more than one table wraps those writes in one Knex transaction. Repositories accept an optional `trx`, defaulting to the shared connection, so the same repository method works standalone or inside a transaction.

| Operation | Tables | Why it must be atomic |
|---|---|---|
| Signup (either method) | `users`, `user_module_access`, `employee_roster` (link) | A user row with no module access, or an unlinked roster match, is a broken half-signed-up state |
| Refresh token rotation | `refresh_tokens` (revoke old + insert new) | No window where neither token is valid (locks the user out) or both are (weakens rotation's theft-detection guarantee) |
| Leave request submission, auto-rejected path | `leave_requests`, `deductions` | A deduction with no corresponding request, or vice versa, is inconsistent and would corrupt reporting |
| Approve/reject leave request | `leave_requests`, `audit_log` | The action and its audit trail must not diverge — an approval that's recorded but not audited, or audited but not applied, defeats the point of auditing |
| Revoke user | `users`, `refresh_tokens`, `audit_log` | Partial revocation (access cut but sessions still valid, or vice versa) defeats the purpose of revoking |
| Pricing: create/update project | `projects`, `project_lines`, `direct_costs`, `scenarios` | Same discipline as today's existing `db.transaction()` usage in `replaceWholeState` — carried forward, not weakened, by the migration to granular endpoints |
| Roster sync job | `employee_roster` (bulk upsert), `roster_sync_log` | The log entry should always reflect what the sync actually did — a sync that partially applies with no log record is undebuggable |

---

## 5. Optimistic locking — targeted, not general

No version-column optimistic locking is applied broadly. Instead, **state-transition writes use a status-guarded conditional update:**

```sql
UPDATE leave_requests
SET status = 'approved', updated_at = now()
WHERE id = ? AND status = 'pending';
-- check affected row count; 0 rows => 409 CONFLICT, someone already acted on this request
```

Applied to: leave request approve/reject, refresh token rotation (`WHERE revoked_at IS NULL`). This is the pattern for "this write should apply exactly once, from a known prior state" — cheaper than general optimistic locking, applied exactly where a realistic race exists (two managers, or a stale client retry), not everywhere by default.

---

## 6. Migrations

Knex migration files in `db/migrations/`, numbered/timestamped, tracked in Knex's own `knex_migrations` table. Run via `npm run migrate` as an explicit deploy step — never automatically on app boot (avoids a race if more than one instance ever starts concurrently). See `docs/operations.md` for the deploy sequence and rollback procedure.
