# CEAS Portal — Architecture

Status: **describes the system as it actually runs today.** Every claim below was checked directly against the running code (`server/src/index.js`, `server/src/db.js`, `server/src/db/migrations/`, `server/package.json`, and each module's own files) — not against a plan, an ADR, or a prior draft of this document.

**A note on why this rewrite exists:** the previous version of this file (and of `docs/database.md`) described a target system — PostgreSQL, Knex, a `modules/pricing/` module, an `employee_roster` table, a full permission-string authorization engine, Zod validators, CI-gated tests — that was planned (`docs/adr/0003`, `docs/migration-plan.md`) but **never built**. The app that actually exists took a different, organically-evolved path: it stayed on `better-sqlite3`, kept the original Pricing/Margin-Planner backend as-is in a single `index.js`, and grew three new modules (`auth`, `employees`, `management`) alongside it with real layering. Both facts are true at once — a real, deliberate decision was made to move to Postgres, and it was never carried out. `docs/migration-plan.md`, `docs/testing.md`, and ADR-0003 are kept as historical record of that decision, not deleted, but they no longer describe this app — see §12.

---

## 1. What this system actually is

One Express app (`server/src/index.js` as the entry point) serving four browser-facing surfaces and one JSON API, all same-origin, all from one deployable:

| Surface | Served at | What it is |
|---|---|---|
| Employees Portal | `/` (and `/employees`, which redirects to `/`) | The landing page for every role. Leave/time-off, KPI scoring, roster, team directory, requests center. The newest, most actively developed part of the app. |
| Margin Planner | `/planner` | The **original** Pricing Portal — a single 2700+ line HTML file (`margin-planner_1.html`) with its backend still living directly in `index.js`. Never migrated into the module structure the rest of the app uses (see §3.1). |
| Commercial Lead dashboard | `/commercial-lead` | Live ClickUp-sourced pipeline/deals reporting for the commercial team. |
| CEO Dashboard | `/ceo` | Manager/admin-only company-health dashboard. Its own `views/js` app. |
| Login | `/login` | Sign in, self-service two-step signup, forgot/reset password. The one place authentication UI lives; every other surface redirects here on a failed silent-refresh. |

Single company (CEAS), no multi-tenancy, roughly 20 real user accounts. That scale is a load-bearing fact for several decisions below (no Redis, no rate limiting beyond auth, no read replica) — they're not oversights, they're sized to reality.

---

## 2. Real folder structure

```
server/
  src/
    index.js                 # entry point: Express app assembly, AND the entire
                              # original Pricing/Margin-Planner backend, inline
                              # (see §3.1 — this is the one real architectural
                              # inconsistency in an otherwise-layered codebase)
    db.js                     # better-sqlite3 connection, WAL mode, the base
                              # inline schema (pre-migration-system tables), and
                              # runMigrations() on boot
    config.js                 # the only file allowed to read process.env
    auth.js, backup.js, create-user.js, seed-owner.js, test-email.js,
    marginPlannerSummary.js   # small standalone CLI/utility scripts, run via
                              # npm scripts (npm run seed, npm run backup:snapshot, ...)

    db/
      migrationRunner.js       # custom, hand-rolled — not Knex, not any library
      migrations/               # 23 numbered .js files as of this writing, each
                                  # exporting up(db); tracked in a schema_migrations
                                  # table; see docs/database.md

    common/                    # shared by every module — see §5
      audit.js
      catchAsync.js
      correlationId.js
      errorHandler.js
      errors.js                 # AppError, ValidationError
      notFoundHandler.js
      permissions.js             # canManageUsers/canAssignRole/canModifyStatus —
                                   # small named functions, not a resolved
                                   # permission-string map (see §6.2)
      logger.js                   # structured JSON to rotating files on disk
      constants/roles.js
      middleware/requireRole.js
      integrations/                # clickupClient.js, clickupWebhookAuth.js,
                                     # resendClient.js — every third-party
                                     # HTTP integration lives here, never inline
                                     # in a service
      realtime/                    # Socket.IO wiring (see §9)

    modules/
      auth/
        controllers/ services/ repositories/ models/ errors.js routes/ container.js
        jwt.js, hash.js            # token signing/verification, bcrypt wrappers —
                                     # live inside auth/, never in common/ or utils/,
                                     # so no other module can mint or verify a
                                     # session token directly
        middleware/authenticate.js
        views/                      # the /login frontend (see §10)

      employees/
        controllers/ services/ repositories/ models/ errors.js routes/ container.js
        views/                      # the / (Employees Portal) frontend

      management/
        container.js, index.js, routes/    # shared wiring for both dashboards below
        commercial-leads/
          controllers/ services/ repositories/ models/ container.js routes/
          jobs/, views/
        ceo-dashboard/
          controllers/ services/ repositories/ models/ container.js routes/
          views/

  public/
    logo-light.png, logo-dark.png
    404.html                        # branded 404 page (server/src/common/notFoundHandler.js)
    shared/                          # browser code shared across multiple frontends —
      accountMenu.js, accountMenu.css
      accountSettings.js
      orgConstants.js
      departments.js
                                     # NOT yet extended to the fetch-wrapper/toast
                                     # pattern each frontend still reimplements
                                     # separately (apiClient.js, dom.js) — a real,
                                     # concrete gap, not a planned omission

  margin-planner_1.html             # the Margin Planner frontend — one large,
                                     # self-contained HTML file, no module system
  render.yaml                        # Render deploy config
  scripts/backup/                     # off-host backup automation (see §11)

docs/
  adr/                               # real decisions, some carried out, some not —
                                      # see §12
  governance/implementation-tracker.md  # the one doc in this repo that stays
                                          # honestly in sync with what's shipped;
                                          # read this for current feature status,
                                          # not this file
```

No `utils/` directory exists at the top level (the old plan reserved one; nothing ever needed it — `common/` covers every actual cross-module need so far). No `app.js`/`server.js` split — `index.js` does both app assembly and `httpServer.listen(...)`.

---

## 3. Module boundaries & dependency rules

**The rule, and it holds:** a module may depend on `common/`, `config.js`, and its own internals. It may never `require()` another module's `services/`, `repositories/`, or `models/` directly — only that module's top-level barrel export (e.g. `require('../auth')`, which exposes `{ router, authenticate, verifyAccessToken }`, never `require('../auth/services/authService')`).

This was checked directly, not assumed: a repo-wide grep for cross-module `services/`/`repositories/`/`models/` imports across `auth`, `employees`, and `management` (including `management`'s own two sub-apps reaching into each other) found **zero violations**. The two cross-module imports that do exist (`management/ceo-dashboard/container.js` and `management/commercial-leads/container.js`, each doing `require('../../auth')`) both go through auth's public barrel, exactly as intended. This is a genuinely well-kept property of the newer code and worth protecting.

The one intentional cross-module data reference is `employees.employees.user_id → auth.users.id`, one-directional (`auth` has no knowledge `employees` exists).

### 3.1 The one real exception: the legacy Pricing/Margin-Planner backend

Every route under `/api/state`, `/api/team`, `/api/projects`, `/api/expenses`, `/api/settings`, etc. is defined directly in `index.js` — no `controllers/`, no `services/`, no `repositories/`. Request handlers call `db.prepare(...).run()` directly, inline. Business logic (serialization, validation via a hand-rolled `numOrDefault` helper, audit calls) lives at module scope in the same file as the Express route wiring.

This is not a bug — the app works, is used daily, and rewriting working code with no immediate need is exactly the kind of speculative churn this project's own engineering principles argue against. But it is a real, standing exception to the layering rule the rest of this document (and `CLAUDE.md`) states as non-negotiable, and any new engineer reading the codebase top-down will notice the inconsistency immediately. `docs/migration-plan.md` originally planned to port this into `modules/pricing/` — that never happened, and there's no `modules/pricing/` directory today. If this code needs a real change (a new endpoint, a bug that requires touching the write path), that's the natural moment to extract just the touched piece into the standard layering rather than adding another inline handler to `index.js`.

---

## 4. Dependency injection — composition root

**Manual factory-function DI, no framework.** This part of the original plan (ADR-0006) was actually built, and matches every module. Every repository, service, and controller is a factory function taking its dependencies as explicit parameters; each module's `container.js` wires its own layer once, at require-time:

```js
// modules/employees/container.js (real, current file)
const employeeRepository = require('./repositories/employeeRepository');
const leaveRequestRepository = require('./repositories/leaveRequestRepository');
// ...16 repositories, 5 models, several rule/service modules...

const audit = require('../../common/audit');
const logger = require('../../common/logger');
const { authenticate } = require('../auth');           // public barrel, not internals

const timeOffService = require('./services/timeOffService')({
  leaveRequestRepository, employeeRepository, /* ... */ audit,
});
const timeOffController = require('./controllers/timeOffController')({ timeOffService });

module.exports = { router: /* ... */, /* ... */ };
```

`routes/` files import only from their own module's `container.js`, never construct a service or repository inline. This is genuinely followed everywhere, including inside `management`'s two sub-apps.

**Why this over a DI container library:** dependencies are visible in a function signature, tests can pass plain mock objects into a factory directly (no `jest.mock` path-interception), and it adds no new dependency. See ADR-0006 for the full reasoning — this is one of the ADRs that was actually carried out as written.

---

## 5. What actually lives in `common/`

| File | Real purpose |
|---|---|
| `errors.js` | `AppError` (message, statusCode, isOperational) and `ValidationError`. Every module extends `AppError` with its own subclass in its own `errors.js` (e.g. `EmployeesError`) rather than sharing one generic error type. |
| `errorHandler.js` | The final Express error-handling middleware. Logs the full error + stack + correlation ID server-side; returns `{ error: "<message>" }` to the client — the *exact* message for a known `AppError`, a generic "The request could not be understood." for any other 4xx, and a generic "Internal server error." for anything else. Never leaks a stack trace or raw DB error to the client. |
| `notFoundHandler.js` | Added during this session's error-handling audit — registered right before `errorHandler`. Unmatched page routes get a branded `public/404.html`; unmatched `/api/*` routes get the same `{ error }` JSON shape every other endpoint uses, instead of Express's bare default `Cannot GET /x` HTML page. |
| `catchAsync.js` | Wraps an async controller so a rejected promise reaches `errorHandler` via `next(error)`, the same way a synchronous throw already would. |
| `audit.js` | `record({ userId, username, action, entityType, entityId, details, ip })` — inserts into `audit_log` and *also* mirrors the same event into the structured JSON logs (tagged with the actor's permanent `users.uuid`, not just the per-request correlation ID), so a support investigation can grep logins, actions, and errors for one person in one place. Fire-and-forget: a failed audit write is logged but never fails the request it's describing. |
| `correlationId.js` | One `crypto.randomUUID()` per request, set on `req.correlationId` and echoed as `X-Correlation-Id`. No `AsyncLocalStorage`-based request-context propagation — correlation ID is passed explicitly where needed, not read from ambient context. |
| `logger.js` | Structured JSON, written to rotating files on the same persistent disk as the database (`DB_DIR/logs`), 14-day retention. Not a stdout-only logger, and not wired to an external transport (Sentry/Datadog) — everything lives on the Render disk today. |
| `permissions.js` | Three small named functions (`canManageUsers`, `canAssignRole`, `canModifyStatus`) encoding the "admin can touch anyone; manager/operations can touch anyone except an admin account" rule. Not a resolved permission-string/role→permission map — see §6.2. |
| `constants/roles.js` | The single source for the six real role strings (see §6.1). |
| `middleware/requireRole.js` | `requireRole([...roles])` — the only general-purpose authorization middleware in the app. Everything more specific than "is this role in this set" is a service-layer check. |
| `integrations/` | `clickupClient.js` (the only place `CLICKUP_API_KEY` is read), `clickupWebhookAuth.js` (HMAC signature verification for inbound webhooks), `resendClient.js` (transactional email). |
| `realtime/` | Socket.IO server, attached to the same `http.createServer(app)` instance `index.js` creates — not a separate process or port. |

No `helmet`, no CSP, no generalized `rateLimit` middleware, no `AsyncLocalStorage` request context, no `common/middleware/validate.js`, no `common/middleware/authorize.js`. None of these are wired anywhere in the running app — see §7 and §8 for what's actually in their place.

---

## 6. Authentication & authorization — mostly matches the original plan

This is the one area where the original architecture document turned out accurate to what was actually built. The access/refresh token split, specifically, is real and correctly implemented:

### 6.1 Real identity model

Self-service signup (no ClickUp-roster gate — that was the plan; reality is simpler): `POST /api/auth/register` creates a `users` row and, in the same flow, an `employees` row via a provisioning callback the `employees` module registers into `auth` at boot (`authModule.setEmployeeProvisioner(...)` in `index.js`) — this is how the two modules cooperate without either importing the other's internals.

Six real roles, defined once in `common/constants/roles.js` and enforced by a CHECK constraint on `users.role`: `employee`, `manager`, `operations`, `finance`, `admin`, `people_culture`. No `user_module_access` join table, no per-user module grants — role alone gates everything, checked per-route via `requireRole([...])` and per-action via small service-layer functions (`canManageUsers`, `canViewBreakdown`, etc., each named for exactly what it decides).

### 6.2 Session mechanics — this part is real and correct

- **Access token**: short-lived JWT (`JWT_EXPIRES_IN`, 2h in production), returned in the response body, held in **frontend memory only** — a module-scoped JS variable, never `localStorage`, never a cookie — across all four frontends. (The legacy Margin Planner used to keep it in `localStorage`; that was fixed in a prior pass — a one-time `localStorage.removeItem('pricingPortalAuth')` cleanup line still runs on load specifically to purge any token left over from before that fix.)
- **Refresh token**: opaque token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie, scoped to `/api/auth/refresh` only, backed by a `refresh_tokens` table (hashed token, revocation timestamp/reason).
- **Role and active-status are re-read from the DB on every authenticated request** (`authenticate` middleware), not trusted from the JWT payload — so a deactivation or role change takes effect immediately, not only once a 2-hour-old token expires.
- **No permissive CORS.** The app is same-origin by design — one deployable serves the API and all four frontends — so no CORS middleware exists at all. (An earlier `cors({ origin: true, credentials: true })` config, which reflected any origin back as allowed, was identified and removed as a real vulnerability, not a hypothetical one.)

### 6.3 What's simpler than planned, and why that's fine

No permission-string resolution engine, no `authorize(...)` middleware, no DB-backed per-user overrides. Authorization is: `requireRole([...])` at the route for coarse checks, plus a handful of named, single-purpose functions at the service layer for anything resource-specific ("is this leave request's employee the same person, or their direct manager?"). For six roles across four surfaces with no multi-tenancy, this is proportionate — the original plan's permission-string map would have added a layer of indirection with no current caller that needs it. If a genuine need for per-user, DB-backed permission overrides ever appears, that's a real trigger to revisit; none has appeared yet.

---

## 7. Database — real engine, real migration system

**Engine: `better-sqlite3` (synchronous SQLite), not PostgreSQL.** The move to Postgres was a real, considered decision (ADR-0003) that was never carried out. WAL mode is enabled. The database is a single file on a mounted Render persistent disk (`DB_DIR`, 1GB).

**Migrations are real, just not Knex.** A hand-rolled runner (`server/src/db/migrationRunner.js`) applies numbered `.js` files from `server/src/db/migrations/` (23 as of this writing), each exporting `up(db)`, tracked in a `schema_migrations`-style table. This is a genuine, working, incrementally-evolved schema-versioning system — it just isn't the tool the original plan named.

Full table-by-table detail lives in `docs/database.md`, which has had the same rewrite this file has.

---

## 8. API structure & response shape

`/api/<module-prefix>/...` per module, mounted in `index.js` (`app.use('/api', authRouter)`, etc.). Static frontends at `/`, `/planner`, `/commercial-lead`, `/ceo`, `/login`.

**Real error envelope: `{ "error": "<message>" }`** — a flat string, not the nested `{ error: { message, code, details } }` shape the original API guidelines describe. `common/errorHandler.js`'s own comment states this explicitly: the flat shape exists to match `margin-planner_1.html`'s `apiRequest` function, which reads `data.error` as a plain string, and changing it would break every existing frontend caller. **Success responses have no consistent envelope** — different endpoints return `{ team: [...] }`, `{ employees: [...] }`, `{ breakdown: [...] }`, etc., named per-resource rather than wrapped in a common `{ data }` key. This is the one area where `docs/api-guidelines.md` still describes a target that wasn't adopted — worth knowing if that file is consulted, since it isn't accurate to what a new endpoint should actually return (match the existing sibling endpoints in the same module instead).

**No API versioning** — single deployable, no independent client release cadence to version against. This part of the original plan matches reality.

---

## 9. Middleware pipeline — what's actually mounted, in order

```
1. correlationId                     — sets req.correlationId, X-Correlation-Id header
2. /api/clickup/webhook               — mounted before express.json(), own express.raw()
3. /api/employees/kpi/clickup-webhook — same reason, separate team-wide webhook
4. express.json({ limit: '2mb' })
5. cookieParser()                      — refresh-token cookie only
6. static file mounts + page routes   — /, /planner, /commercial-lead, /ceo, /login,
                                          /uploads/employees, shared /public assets
7. /api routes                         — authRouter, management.router, employeesRouter
   (each route individually applies authenticate / requireRole([...]) as needed —
   there is no single blanket "everything under /api needs auth" middleware; a few
   routes, like health and the ClickUp webhooks, are intentionally public or use
   their own HMAC check instead of a user session)
8. notFoundHandler                     — added this session; must run after every
                                          route/static mount, before errorHandler
9. errorHandler                        — must be last
```

No `helmet`, no generalized rate limiting (`express-rate-limit` is applied to exactly two routes: `/api/auth/login`-adjacent endpoints at 120 req/min, and `/api/auth/forgot-password` at 5 req/15min — nowhere else), no request-completion logger middleware, no readiness probe beyond a single `GET /api/health` returning `{ ok: true }` with no dependency checks. No graceful-shutdown handling — no `SIGTERM`/`SIGINT` listener anywhere in the codebase; the process relies entirely on the host (Render) to manage restarts.

---

## 10. Frontend architecture — already at the target state, just never documented as such

The original plan treated "vanilla JS ES modules, no framework, no bundler" as a *future* initiative, separate from and after the backend migration. That's backwards from what happened: **the backend migration (to Postgres/Knex/`modules/pricing`) never happened, but the frontend target architecture already has, for three of the four surfaces.**

- `employees/`, `commercial-leads/`, and `ceo-dashboard/` each have their own `views/js/` app using native `<script type="module">` ES modules — `import`/`export`, no bundler, no framework, no build step. Each has its own `apiClient.js` (fetch wrapper with silent-refresh-on-401 and error-message parsing), `dom.js` (tiny `$`/`escapeHtml`/`toast` helpers), and `state.js`.
- **That per-app duplication is a real, current cost, not a planned structure.** All three `apiClient.js` files are near-identical hand-copies of each other; two of the three (`commercial-leads`, `ceo-dashboard`) had a real bug — silently discarding the server's actual error message — that existed in both places independently until this session's error-handling audit found and fixed it in both. The fix that already existed correctly in `employees/apiClient.js` simply hadn't been shared.
- Genuine cross-app sharing already exists and works, via `server/public/shared/`: `accountMenu.js`/`.css`, `accountSettings.js`, `orgConstants.js`, `departments.js` — loaded as plain (non-module) `<script>` tags that attach to `window.*`, included by every frontend. Extending this same directory to cover `apiClient.js`/`dom.js` (or converting those specific shared files to ES modules importable by absolute path, since the browser supports that fine same-origin) is the natural next step, not a new pattern.
- `/login` (`modules/auth/views/`) follows the same ES-module pattern.
- `/planner` (`margin-planner_1.html`) is the one true outlier: a single ~2700-line HTML file with an inline `<script>`, no module system at all — the original Pricing Portal frontend, never touched by the ES-module migration the other three surfaces got. It does, correctly, keep its access token in memory only (a `_memoryAuth` module-scoped variable) rather than `localStorage` — that part was fixed even though the rest of the file's structure wasn't.

No framework (React/Vue/etc.) and no bundler anywhere. That absence is a deliberate, ADR-tracked deferral (see `docs/adr/`), not a gap — nothing about this app's scale currently justifies one.

---

## 11. Deployment & operations — real, not planned

Single Render web service (`render.yaml`), Node runtime, `rootDir: server`, `autoDeploy: true` — every push to the watched branch deploys directly to production. **No CI pipeline exists** (`.github/` doesn't exist in this repo) — no automated lint, test, or `npm audit` gate runs between a merge and a production deploy, despite `CLAUDE.md` describing CI as gating every merge. The only gate is manual review before merge.

The database lives on a 1GB Render persistent disk (`DB_DIR=/var/data`). **Backup is a real, working script** (`scripts/backup/run-backup.sh`) using `better-sqlite3`'s online backup API (WAL-safe, unlike a raw file copy) — but it's triggered by `launchd` on one person's personal Mac, polling periodically because that laptop sleeps overnight, with failure notification via a local `osascript` desktop popup. There is no backup path that doesn't depend on that specific machine being powered on, and no external monitoring that would catch backups silently not running at all (as opposed to running and failing).

---

## 12. What the historical planning docs got right vs. wrong

For anyone who reads `docs/adr/`, `docs/migration-plan.md`, or `docs/testing.md` after this file: those documents record a real plan that was made and then not executed, not a set of lies. Specifically:

| Document | What it says | What actually happened |
|---|---|---|
| ADR-0003 | Move to PostgreSQL + Knex | Never done. Still `better-sqlite3`, still a hand-rolled migration runner. |
| ADR-0001 | Three modules: `pricing`, `employees`, `auth` | `pricing` was never extracted (§3.1); a fourth module, `management` (with two sub-apps), was built instead and isn't mentioned in the ADR. |
| ADR-0005 (authorization) | Resolved permission-string map | Simpler role-array + named-function checks were built instead (§6.3) — proportionate to 6 roles, not a shortfall. |
| `docs/migration-plan.md` | Milestone-gated rewrite sequence, `employee_roster` table, `user_module_access` | None of this schema or sequencing exists. The real `employees`/`leave_requests`/KPI tables were built directly, incrementally, via the real migration system (§7), without the planned rewrite. |
| `docs/testing.md` | Unit + integration test strategy, CI-gated | Zero automated tests exist (`npm test` → "Missing script"), and no CI exists to gate anything. |
| ADR-0006 (manual DI) | Factory-function DI, no framework | **Built exactly as decided** — the one plan that was carried out end-to-end. |
| ADR-0002 (auth) | Access-token-in-memory / refresh-in-httpOnly-cookie split | **Built exactly as decided** (§6.2). |

Two ADRs matching reality out of the ones checked is not a coincidence worth reading too much into either direction — it reflects that this app grew through real, pressing feature work (leave management, KPI scoring, commercial reporting) rather than through executing the original migration plan in sequence. `docs/governance/implementation-tracker.md` is the document that has stayed honestly current with that growth; treat it, not the planning documents above, as the source for "what does this app actually do today."

---

## 13. Related documents

- `docs/database.md` — real schema, rewritten alongside this file
- `docs/governance/implementation-tracker.md` — current, living feature-by-feature status; the most reliably up-to-date document in this repo
- `docs/adr/` — real decision records; §12 above notes which ones match reality
- `docs/coding-standards.md`, `docs/engineering-principles.md` — naming/layering/philosophy; largely still accurate for the newer modules (§3), not for `index.js` (§3.1)
- `docs/security.md` — written against the original plan; cross-check specific claims (helmet, CSP, rate limiting) against §5/§9 above before trusting them
- `docs/api-guidelines.md` — describes the nested envelope that was **not** adopted; see §8 for the real shape
- `docs/migration-plan.md`, `docs/testing.md`, `docs/frontend-architecture.md` — historical planning documents; see §12 before treating anything in them as current
- `CLAUDE.md` — repo-root instructions for AI-assisted sessions; still broadly accurate for module layering and security rules, less so for the specific file paths (`validators/`, `common/constants/permissions.js`) it names, which don't exist under those names in the real tree
