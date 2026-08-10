# CEAS Portal — Architecture

Status: **Approved in principle; hardened per Principal Engineer review — pending final sign-off before implementation**
Supersedes: the root-level `ARCHITECTURE.md` (Phase 2 draft). This is the canonical, current architecture document.

This document defines the target architecture for merging Pricing Portal and Employees Portal into a single modular monolith. It is one of several documents under `/docs` — see `docs/adr/` for the reasoning behind individual decisions in more depth, and the sibling documents listed at the bottom for topic-specific detail. `CLAUDE.md` at the repo root is the condensed version of this document for AI-assisted sessions.

---

## 1. Folder Structure

```
src/
  modules/
    auth/
      controllers/
      services/
      repositories/
      models/
      validators/
      utils/
        jwt.js          # token signing/verification — auth-only, never imported elsewhere
        hash.js          # bcrypt wrappers — auth-only
      errors.js
      routes.js
      container.js       # wires this module's repositories -> services -> controllers

    pricing/
      controllers/
      services/
      repositories/
      models/
      validators/
      errors.js
      routes.js
      container.js

    employees/
      controllers/
      services/
      repositories/
      models/
      validators/
      errors.js
      routes.js
      container.js
      jobs/
        rosterSync.job.js        # scheduled ClickUp -> employee_roster sync + offboarding detection
      integrations/
        clickup.client.js        # only place CLICKUP_API_KEY is read/used

  common/
    logger/logger.js
    audit/
      audit.repository.js
      audit.service.js
      audit.routes.js             # GET /api/audit-log, admin-only
    error/
      AppError.js
      errorHandler.js
      catchAsync.js
    correlation/
      correlationId.js
      requestContext.js            # AsyncLocalStorage-based context
    middleware/
      authenticate.js
      authorize.js                  # permission-string based, see §4
      validate.js
      requestLogger.js
      rateLimit.js
      security.js                    # helmet + CSP wiring
    constants/
      roles.js
      modules.js
      permissions.js                 # ROLE_PERMISSIONS map, see §4.2

  utils/
    # intentionally empty at present — reserved for genuinely cross-module
    # pure functions. Nothing qualifies yet (see ADR-002 for why jwt/hash
    # moved into modules/auth instead of living here).

  config/
    index.js        # loads + validates env vars once, exports frozen config object
    db.js             # Knex/pg connection + pool

  db/
    migrations/
    seeds/

  app.js             # express app assembly (middleware pipeline + route + health mounting), no listen()
  server.js          # imports app, calls listen(), graceful shutdown, signal handling

public/
  shared/
    js/   (apiClient.js, auth.js, dom.js, state.js, format.js — see docs/frontend-architecture.md)
    css/
  pricing/
    index.html
  employees/
    index.html

tests/
  unit/modules/{auth,pricing,employees}/...
  integration/{auth,pricing,employees}/...
  fixtures/
  setup.js

.env.example
package.json
```

### 1.1 What changed from the Phase 2 draft, and why

| Change | Reasoning |
|---|---|
| `jwt.js`, `hash.js` moved from top-level `utils/` into `modules/auth/utils/` | See ADR-002. Prevents any module from bypassing `auth`'s service layer to mint or verify tokens directly — the previous placement made that possible even if unintended. |
| Added `container.js` per module | See ADR-006. Manual factory-function dependency injection — explicit wiring, no framework. |
| Added `common/audit/` | See ADR-007. Operational logs and audit logs serve different purposes (debugging vs. accountability) and now have separate homes. |
| Added `common/constants/permissions.js` | See §4.2. Authorization checks reference permission strings resolved through a static role→permission map, not raw role names scattered through route definitions. |
| Added `common/middleware/rateLimit.js`, `security.js` | See `docs/security.md`. |
| `utils/` now explicitly documented as empty-on-purpose | Previously implied to hold `jwt.js`/`hash.js`; now genuinely has no occupants. Documenting this prevents someone "helpfully" moving something there without justification. |

---

## 2. Module Boundaries & Dependency Rules

```
        ┌─────────────┐   ┌──────────────┐   ┌───────────────┐
        │  auth        │   │  pricing     │   │  employees     │
        └──────┬───────┘   └──────┬───────┘   └──────┬────────┘
               │                  │                   │
               └────────┬─────────┴─────────┬─────────┘
                         ▼                   ▼
                    common/               utils/
           (logger, audit, errors,     (reserved,
          middleware, correlation,      currently
               constants)                empty)
```

**Rules (enforced by code review; see `docs/coding-standards.md` for how this is checked):**

1. `modules/*` may depend on `common/`, `utils/`, `config/`. Never the reverse.
2. No module imports another module's `services/`, `repositories/`, or `models/` directly. There is no current cross-module data need — if one appears later (e.g. a future CRM module needing a Pricing client name), it is solved explicitly when it's real, not pre-built.
3. Each module owns its own database tables in the one shared Postgres database. The one intentional exception is documented in §5.3 (`employee_roster.user_id` → `auth.users`).
4. Each module owns its own `routes.js`, mounted under its own path prefix in `app.js`, and its own `container.js` for internal wiring. `app.js` is the only file aware of all three modules simultaneously.

---

## 3. Dependency Injection — Composition Root

**Decision: manual factory-function DI, no framework.** See ADR-006 for full reasoning.

Every repository, service, and controller is a factory function taking its dependencies as explicit parameters:

```js
// modules/employees/services/leaveRequest.service.js
module.exports = function createLeaveRequestService({ leaveRequestRepository, employeeRosterRepository, auditService, logger }) {
  return {
    async submitRequest(input, actingUser) { /* ... */ },
    async approve(requestId, actingUser) { /* ... */ },
  };
};
```

Each module's `container.js` wires its own layer once, at startup:

```js
// modules/employees/container.js
const db = require('../../config/db');
const logger = require('../../common/logger/logger');
const auditService = require('../../common/audit/audit.service');

const leaveRequestRepository = require('./repositories/leaveRequest.repository')(db);
const leaveRequestService = require('./services/leaveRequest.service')({ leaveRequestRepository, auditService, logger });
const leaveRequestController = require('./controllers/leaveRequest.controller')({ leaveRequestService });

module.exports = { leaveRequestController, /* ... */ };
```

`routes.js` imports only from its module's `container.js`, never constructs dependencies itself.

**Why this and not a DI container library:** dependencies are visible in a function signature (readable without tracing decorators/reflection), tests pass plain mock objects directly into factories (no `jest.mock` module-path mocking), and it adds zero new dependencies. It is explicitly *not* automatic/reflective wiring — every wire-up is one visible line in a `container.js`.

---

## 4. Authentication Architecture

### 4.1 Identity flow (roster-gated, dual-method self-signup)

```
ClickUp workspace members
        │  (scheduled job, server-side, every 15-30 min)
        ▼
employee_roster  (name, email, clickup_id, department, location, active)
        │
        │  employee visits /employees, clicks "Sign up"
        ▼
POST /api/auth/signup/google   or   POST /api/auth/signup/password
        │
        ├─ verify identity (Google ID token verified server-side via
        │   google-auth-library, OR email+password with a fresh bcrypt hash)
        ├─ look up employee_roster WHERE email = ? AND active = true
        │     no match  → 403, signup rejected
        │     match     → create `users` row (transaction, see §5.4), link employee_roster.user_id
        ▼
issue access token (15 min, in-memory only) + refresh token (30 days, httpOnly cookie)
```

### 4.2 Session mechanics — revised for CSRF resistance

**This section revises the Phase 2 draft.** Originally both tokens were described as living in httpOnly cookies. After the security review (see `docs/security.md`, ADR-002), the split is:

- **Access token**: short-lived (15 min) JWT, signed with `JWT_ACCESS_SECRET`, carries `sub` (user id), `role`, and a snapshot of `user_module_access`. Returned in the response body on login/refresh, held in **frontend memory only** (a module-scoped JS variable — never `localStorage`, never a cookie), attached to requests via `Authorization: Bearer <token>`.
- **Refresh token**: opaque random string, stored **hashed** in `refresh_tokens`, set as an `httpOnly`, `Secure`, `SameSite=Lax` cookie, 30-day expiry. Used only against `POST /api/auth/refresh`.

**Why the split:** an httpOnly cookie protects a token from XSS (JS can't read it) but not CSRF (the browser sends it automatically on any request to that origin, including ones triggered by a malicious page). A JS-memory token protects against CSRF (nothing can attach it to a request except our own code, explicitly) but not XSS (if the page has an XSS bug, injected script can read memory too). Using each mechanism for the token it's actually good at — refresh token (long-lived, high-value, rarely sent) in the CSRF-exposed-but-XSS-safe cookie; access token (short-lived, sent constantly) in the XSS-exposed-but-CSRF-safe memory slot — is standard practice and meaningfully better than picking one mechanism for both.

**This makes frontend XSS-hardening load-bearing, not optional.** If the page has an XSS vulnerability, the access-token-in-memory protection is void (injected script reads it directly). Both current frontends build DOM content via string concatenation into `innerHTML` in multiple places. Auditing and fixing this is required as part of the frontend migration work (see `docs/frontend-architecture.md` §5 and `docs/security.md` §XSS) — not a "nice to have," because it's now a precondition for the auth model actually holding.

- **Refresh rotation**: every `/api/auth/refresh` call issues a new refresh token and marks the old one used. A reused (already-rotated) token is treated as theft: all of that user's refresh tokens are revoked immediately, forcing re-authentication.
- **Revocation (offboarding, manual revoke)**: sets `users.is_active = false`, revokes all `refresh_tokens` rows for that user. The current access token (if any) remains valid for up to 15 minutes — an accepted tradeoff for keeping access tokens stateless. See `docs/security.md` for the option to harden this later if ever required.
- **`users.is_active` vs. `employee_roster.active`**: two distinct flags. `users.is_active` is login/access (auth concern, can be revoked independent of employment status — e.g. a security incident). `employee_roster.active` is HR employment status, driven by the ClickUp sync. Offboarding (`employee_roster.active → false`) cascades to revoking access (`users.is_active → false`), but not the reverse — an admin can revoke portal access for someone who is still, per HR records, employed.

---

## 5. Authorization Architecture

### 5.1 Role & module-access model

Single flat role enum, orthogonal binary module access (per your Phase 1 decision):

```
users
  id, email, password_hash (nullable), google_sub (nullable), role, is_active

user_module_access   (user_id, module_code)   -- PK(user_id, module_code)
```

`module_code`: `'pricing' | 'employees'`, extendable without a migration (join table, not boolean columns — this is exactly why it was designed as a table).

**Roles:** `admin`, `pricing_user`, `hr_admin`, `manager`, `employee`. Same table as Phase 2 — unchanged.

### 5.2 Permission-string authorization (revised from Phase 2's raw-role checks)

**Decision:** routes and services reference **permission strings**, not role arrays, resolved through a static map:

```js
// common/constants/permissions.js
const ROLE_PERMISSIONS = {
  admin:       ['*'],
  hr_admin:    ['leave:approve:any', 'leave:reject:any', 'employee:revoke:any', 'employee:manager:assign', 'roster:read', 'audit:read'],
  manager:     ['leave:approve:team', 'leave:reject:team', 'employee:revoke:any'],
  employee:    ['leave:request', 'leave:read:own'],
  pricing_user:['pricing:*'],
};
```

```js
router.put('/leave-requests/:id/approve', authenticate, authorize('leave:approve:team', 'leave:approve:any'), ...);
```

`authorize(...)` checks whether the resolved permission set for `req.user.role` (plus module access) intersects the required permissions for the route.

**Why this and not full permission-based auth now:** you explicitly chose the simpler role-based model in Phase 1, and a fully granular, per-user, DB-backed permission system would be real over-engineering for 5 roles across 2 modules — there's no current requirement for it. This is the cheap middle ground: call sites already speak in permissions, so if real granular/per-user overrides are needed later, only `ROLE_PERMISSIONS`'s *resolution* changes (static map → DB-backed lookup) — no route or service code changes. See ADR-005.

### 5.3 The `employee_roster` ↔ `users` bridge

```
employee_roster
  id, full_name, email (unique), clickup_id (unique), department, location,
  manager_employee_id  -> employee_roster.id (nullable, self-referencing),
  active, synced_at,
  user_id  -> auth.users.id (nullable, unique)
```

One-directional FK crossing a module boundary: `employees.employee_roster → auth.users`, never the reverse. `auth` has no knowledge `employees` exists, keeping it genuinely reusable by any future module the same way.

`manager_employee_id` is set via a small dedicated "assign manager" screen (P&C/admin), since ClickUp has no standing reporting-line field (confirmed in Phase 1).

### 5.4 Where checks happen

- **`authenticate` middleware**: verifies the access token, populates `req.user = { id, role, moduleAccess }` from the token payload (see §4.2 staleness note).
- **`authorize(...permissions)` middleware**: coarse-grained — does this user's role resolve to one of the required permissions, and do they have module access? Pure in-memory check, no DB round-trip.
- **Service layer**: fine-grained, resource-specific — e.g. "is this leave request's `employee_id` the same person as `req.user.id`, or do they report to `req.user.id` (manager scenario)?" Requires loading the actual row, so it cannot be middleware.

**Note on manager scope (carried over from Phase 2, restated):** per your explicit decision, **revoke** is unscoped for `manager` (any employee, not just direct reports). **Approve/reject** defaults to scoped (direct reports only), since it's a routing concept tied to `manager_id`, not a decision I silently reversed — flagged again here for final confirmation before implementation.

---

## 6. Database Design

**Engine: PostgreSQL. Query layer: Knex.js** (query builder + migration runner in one dependency — see ADR-003).

### 6.1 Schema (unchanged core shape from Phase 2 — see `docs/database.md` for the living, authoritative version kept in sync with migrations)

- **auth**: `users`, `refresh_tokens`, `user_module_access`
- **employees**: `employee_roster`, `leave_requests`, `deductions`, `roster_sync_log` (`kpi_scores` deferred to its own milestone — schema not guessed at ahead of reviewing the KPI framework)
- **common**: `audit_log` (see §8)
- **pricing**: existing schema, ported to Postgres types, no redesign

### 6.2 Transactions — explicit rule

**Any service method that writes to more than one table wraps those writes in a single Knex transaction.** Repositories accept an optional `trx` parameter (default: the main connection) so the same repository method works standalone or inside a transaction:

```js
// repository
exports.create = (data, trx = db) => trx('leave_requests').insert(data).returning('*');

// service
await db.transaction(async (trx) => {
  const request = await leaveRequestRepository.create(data, trx);
  if (autoRejected) await deductionRepository.create({ leaveRequestId: request.id, ... }, trx);
  await auditService.record({ action: 'leave.submitted', ... }, trx);
});
```

**Enumerated transaction boundaries** (the operations that must use this pattern):

| Operation | Tables touched | Why atomic |
|---|---|---|
| Signup | `users`, `user_module_access`, `employee_roster` (link) | Partial signup (account without module access) is a broken state |
| Refresh token rotation | `refresh_tokens` (revoke old, insert new) | No window where neither token is valid, or both are |
| Leave request submission (auto-rejected path) | `leave_requests`, `deductions` | A logged deduction with no corresponding request (or vice versa) is inconsistent |
| Revoke user | `users`, `refresh_tokens`, `audit_log` | Access must be fully cut, not partially |
| Pricing: create project | `projects`, `project_lines`, `direct_costs`, `scenarios` | Same discipline already present in today's `db.transaction()` usage — carried forward |

### 6.3 Indexes — explicit rule

**Every foreign key column gets an explicit index.** Postgres does not automatically index the referencing side of a foreign key (only the referenced/primary-key side) — this is a common, easy-to-miss production gap. Additional indexes:

- `users.email`, `users.google_sub` — unique
- `refresh_tokens.token_hash`, `refresh_tokens.user_id`
- `employee_roster.email`, `employee_roster.clickup_id` — unique; `employee_roster.manager_employee_id`, `employee_roster.user_id` — unique
- `leave_requests.employee_id`, `leave_requests.status`; composite `(employee_id, start_date, end_date)` for overlap/clash-rule queries
- `audit_log.actor_user_id`, `audit_log(target_type, target_id)`, `audit_log.created_at`

### 6.4 Constraints

- CHECK constraints on `TEXT` columns for enums (`role`, `leave_requests.status`, `module_code`) — **not** native Postgres `ENUM` types. Reasoning: enum-type migrations (`ALTER TYPE ... ADD VALUE`) are more disruptive than a CHECK-constraint migration, and this project has already revised its role model more than once during design — additive changes to these value sets are a realistic, recurring need, not a hypothetical.
- Foreign keys default to `ON DELETE RESTRICT`, given the revoke-not-delete policy — nothing should be able to cascade-destroy retained history. In practice, no code path ever hard-deletes a `users` or `employee_roster` row (revoke is a soft-delete flag), which makes this mostly a defensive guarantee rather than an active concern.

### 6.5 Optimistic locking — targeted, not general

**Decision: no version-column optimistic locking anywhere, as a general mechanism.** At this scale (single company, small team, no reported contention), it's complexity without a current problem to solve.

**Instead:** state-transition writes use a **status-guarded conditional UPDATE** — cheap, targeted, solves the actual realistic race (two managers approving the same pending request simultaneously) without a general-purpose scheme:

```sql
UPDATE leave_requests SET status = 'approved', ... WHERE id = ? AND status = 'pending'
```

If the affected-row-count is 0, the request was already acted on — return a 409 conflict. The same pattern already governs refresh-token rotation (§4.2). This is the pattern for any "this action should apply exactly once to a specific state," applied where it's actually needed rather than everywhere.

---

## 7. API Structure & Routing Strategy

See `docs/api-guidelines.md` for the full convention (response envelope, naming, pagination stance, error shape, versioning decision). Summary: `/api/<module>/<resource>`, static frontends at `/pricing` and `/employees`, consistent `{ data }` / `{ error: { message, code, details } }` envelopes across all three modules, no API versioning (single deployable, no independent client release cadence to version against).

---

## 8. Audit Logging

**New in this revision.** See ADR-007 for full reasoning; summary here.

Operational logs (§10) answer "what is the system doing and why did it break." Audit logs answer "who did what, to what, when" — a durable, queryable, append-only record distinct from stdout logs, which are typically short-retention and not structured for per-actor queries.

```
audit_log
  id, actor_user_id, action, target_type, target_id, metadata (jsonb), correlation_id, created_at
```

Lives in `common/audit/` (repository + a thin `record()` service), not inside any single module, since it's used by all three. Called **explicitly, inline** from services at the points that matter — no event system (see ADR-008 for why that's deferred):

- Role/module-access changes
- Salary edits (`pricing` — `team_members.salary`)
- Leave approvals/rejections
- User revocations
- Manager reassignment
- Any future action matching this shape

A minimal admin-only read endpoint (`GET /api/audit-log`) exposes it for review. Entries are never updated or deleted at the application layer — immutability is part of what makes it an audit trail rather than just another table. Retention policy (how long entries are kept) is a compliance/legal question, not an architecture one — noted as an open policy question, not assumed.

---

## 9. Middleware Pipeline

```
1. correlationId          — first; everything after wants the ID
2. requestContext.init    — opens an AsyncLocalStorage store for this request
3. helmet()                — security headers (see docs/security.md)
4. express.json({ limit }) — body parsing, size-limited
5. cookieParser()           — refresh-token cookie only
6. requestLogger             — logs request start; logs completion on res 'finish'
7. rateLimit (auth routes stricter than general API)
8. [per-route] authenticate → authorize(...) → validate(schema) → controller
9. /health, /ready          — mounted before auth, unauthenticated
10. 404 handler
11. errorHandler             — must be last
```

Order reasoning unchanged from Phase 2 (`authenticate` before `authorize`, `validate` after `authorize`, `errorHandler` last) — `helmet`/`rateLimit` added per the security review, `/health`/`/ready` explicitly called out as unauthenticated and mounted early.

---

## 10. Logging Strategy

Structured JSON to stdout, `LOG_LEVEL`-gated, singleton logger, every line auto-includes `timestamp`, `level`, `message`, `correlationId`, `userId` (via `requestContext`, AsyncLocalStorage — see ADR discussion in the Phase 2 draft, unchanged). **Never logs secrets** — passwords, tokens, and hashes are never passed into logger metadata, even incidentally via a wholesale `req.body` dump on auth routes. Built as a thin wrapper so a transport (Sentry, Datadog) can be swapped in later without call-site changes.

---

## 11. Error Handling

`AppError` (`message`, `statusCode`, `isOperational`, plus `code` — see `docs/api-guidelines.md`). Per-module `errors.js` exporting factories, not singletons. `catchAsync(fn)` wraps every controller. Centralized `errorHandler` logs with correlation ID and returns the standard envelope; never leaks internals on non-operational (unexpected) errors.

---

## 12. Validation Strategy

Zod schemas in each module's `validators/`. The `validate(schema)` middleware **replaces** `req.body`/`params`/`query` with the parsed (validated, coerced, defaulted) result — that parsed object is the DTO; no separate hand-written DTO class layer, since it would only duplicate what Zod already provides. Controllers pass the parsed object (plus relevant `req.user`/`req.params` context) into services; services never see raw `req`.

**Transport validation** (shape/type/presence) lives in `validators/`. **Business validation** (notice periods, auto-reject conditions, WFH quota, clash pairs, handover-complete gate — anything requiring a DB lookup) lives in the service layer. This is what makes *"the request is validated against the time-off policy before reaching ClickUp"* concrete: that check runs in `employees/services/leaveRequest.service.js`, before anything is written to our DB, let alone (optionally) mirrored to ClickUp.

---

## 13. Repository & Service Layer

Unchanged in principle from Phase 2, now expressed as DI factories (§3): repositories are pure data access via Knex (no business logic, no `req`/`res`), services own business logic and are the only layer calling repositories, controllers translate HTTP ↔ service calls and nothing else. "Models" means row-shape mappers and enum-like constants, not ORM classes — no ORM is introduced; this schema doesn't justify one.

---

## 14. Security

Full detail in `docs/security.md`. Headline items and why each exists:

| Control | Why |
|---|---|
| Helmet | Sensible security headers with near-zero effort/risk |
| Rate limiting (stricter on `/api/auth/*`) | Blunts credential-stuffing/brute-force against login, signup, refresh |
| Access token in memory, refresh token only in httpOnly cookie | CSRF resistance for the bulk of requests; see §4.2 |
| **No permissive CORS** (dropping today's `origin: true, credentials: true`) | Same-origin deployment means we don't need cross-origin credentialed requests at all; today's config is a real, existing vulnerability |
| CSP (nonce-based for the single inline `<script>` per page) | Defense-in-depth against XSS, which the token-in-memory model now depends on |
| Parameterized queries only (Knex, no raw string interpolation) | SQL injection prevention |
| Password minimum length (≥10 chars) + bcrypt cost 12 | Hashing strength matters more than composition rules (NIST guidance) |
| `.env`-only secrets, validated at startup, never logged | Prevents the kind of exposure the current Employees Portal has today |
| `npm audit` / Dependabot in CI | Catches known-vulnerable dependencies before they ship |

---

## 15. Caching

No caching layer is introduced now. Never cache anything auth/permission-decision-related beyond the already-accepted 15-minute access-token staleness window. Redis/distributed caching is **explicitly out of scope** — current and projected scale (single company, one Postgres instance, single deployable) doesn't justify the operational cost. If a specific hot, expensive, cacheable query is identified later, an in-process TTL map is the first escalation step; Redis becomes justified only if the app ever runs multiple instances needing shared cache state.

---

## 16. Health Endpoints

- `GET /health` — liveness. Confirms the process is alive and responsive. No dependency checks. Used by the hosting platform to decide whether to restart the process.
- `GET /ready` — readiness. Confirms the app can serve real traffic (DB pool responds to a trivial query). Relevant once more than one instance or a deploy-time traffic cutover is involved.

Both unauthenticated, both return minimal bodies (no internal details).

---

## 17. Graceful Shutdown

On `SIGTERM`/`SIGINT`:
1. Stop accepting new connections (`server.close()`).
2. Cancel the roster-sync cron job (no dangling timers).
3. Drain in-flight requests, bounded by a timeout (e.g. 10s), after which remaining connections are force-closed.
4. Close the Knex connection pool.
5. Exit.

Uncaught exceptions and unhandled promise rejections are logged as non-operational errors, and the process **exits** rather than continuing in an unknown state — under a process manager (Render, etc.) that restarts it, a clean crash-and-restart is safer than limping on.

---

## 18. Deployment Architecture

Unchanged from Phase 2: single Express deployable, staging + production environments, managed Postgres, migrations as an explicit deploy step (`npm run migrate`), roster sync via in-process `node-cron` (documented single-instance caveat unchanged — see `docs/operations.md`).

---

## 19. Testing Strategy

Unit tests for services (repositories mocked/stubbed via the DI factories — no `jest.mock` needed), integration tests for critical routes via Supertest against the real `app.js`, CI-gated. Full detail in `docs/testing.md`.

---

## 20. Frontend Architecture

Full detail in `docs/frontend-architecture.md`. Both frontends remain single HTML files for the initial backend migration (unchanged decision — migration-risk driven). The documented target frontend architecture (vanilla-JS ES modules, no framework, no bundler) is a separate, later initiative once the backend migration is stable.

---

## 21. Explicit Backlog

Unchanged from Phase 2 — see `docs/migration-plan.md` for how these are sequenced after the initial migration: P&C+manager handover approval workflow, live presence dashboard build-out, location-based work-week calendars, in-portal Pillar A form, automatic Pillar B scoring, leaderboard, onboarding/offboarding notifications, optional ClickUp mirroring of approved requests.

---

## 22. Related Documents

- `docs/adr/` — Architecture Decision Records for every major decision referenced above
- `docs/security.md` — full security control list and reasoning
- `docs/api-guidelines.md` — REST conventions, envelope, error shape
- `docs/database.md` — living schema reference, kept in sync with migrations
- `docs/frontend-architecture.md` — target frontend structure
- `docs/coding-standards.md` — naming, layering, style
- `docs/engineering-principles.md` — project philosophy, when to add abstraction
- `docs/testing.md` — testing strategy detail
- `docs/operations.md` — deploy/migrate/rollback/secret-rotation runbook
- `docs/migration-plan.md` — milestone-by-milestone implementation plan
- `CLAUDE.md` — condensed engineering constitution for AI-assisted sessions
