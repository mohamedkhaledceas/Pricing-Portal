# CLAUDE.md

This is the engineering constitution for the CEAS Portal. Read this first in any session touching this codebase. It summarizes the reasoning captured in full in `/docs` — when this file and a document under `/docs` seem to disagree, `/docs` is the detailed source of truth and this file should be corrected to match it, not the other way around.

---

## What this project is

A modular monolith merging two prior systems: **Pricing Portal** (a working Node/Express/SQLite app with real auth) and **Employees Portal** (a single static HTML file with no backend, a hardcoded live API key exposed in client JS, and client-side-only "authentication" that any user could bypass via devtools). The merge is not a rewrite of Pricing Portal — its backend architecture was sound and is being extended, not replaced. Employees Portal contributed no reusable backend architecture; only its UI and business-rule *specification* carry forward, re-implemented server-side and secured.

Single company (CEAS), no multi-tenancy. Internal tool, small user base, but handling real salary and HR data — treat security and data-handling decisions accordingly, not as "it's just internal, it doesn't matter."

---

## Philosophy — read `docs/engineering-principles.md` for the full reasoning

- **Simplicity is the default. Abstraction is earned, not assumed.** Before adding a layer, a pattern, or a generalized mechanism, ask: does this solve a problem that exists right now? If the honest answer is "might, someday," it doesn't get built — it gets a documented trigger condition instead (see the ADRs in `docs/adr/` for several worked examples: deferred domain events, deferred full permission system, deferred Redis, deferred frontend framework).
- **Change the representation before you need the capability.** Where cheap, prefer the data/API shape that won't need to change later (permission strings resolved through a static map, a join table instead of boolean columns) over building the capability itself early. This is not the same as over-engineering — it's picking the equally-simple option that doesn't require touching every call site later.
- **Explicit over clever.** Manual dependency injection via factory functions, not a DI container. Status-guarded conditional updates, not general optimistic locking. Permission strings resolved through a plain object, not a rules engine. Every one of these was a deliberate choice of the more boring, more readable option over the more powerful one.
- **Every deferral is documented, never silent.** If something looks like a gap, check `docs/adr/` and `docs/architecture.md` before assuming it was missed — it may be a deliberate, reasoned deferral with a stated trigger for revisiting.

---

## Module boundaries — non-negotiable

```
src/modules/{auth, pricing, employees, ...future}/
src/common/     (logger, audit, error handling, correlation, middleware, constants — shared by all modules)
src/utils/      (reserved for genuinely cross-module pure functions — currently empty; see docs/adr/0002)
```

**Rules, enforced in code review:**
1. A module may import from `common/`, `utils/`, `config/`. Never from another module's `services/`, `repositories/`, or `models/`.
2. Each module owns its own database tables. The one intentional exception is `employees.employee_roster.user_id → auth.users.id` (one-directional; `auth` never references `employees`).
3. `auth`'s `jwt.js`/`hash.js` live **inside** `modules/auth/`, not in top-level `utils/` — no other module should ever mint or verify a session token directly. See `docs/adr/0002-authentication-architecture.md`.
4. If work seems to require importing across a module boundary, that's a signal to stop and design an explicit interface (or ask whether the need is real yet) — not to reach through the boundary "just this once."

## Layering — non-negotiable within a module

`routes.js → controllers/ → services/ → repositories/ → models/`

- **Repositories**: the only layer that writes SQL (via Knex). No business logic. No `req`/`res`.
- **Services**: business logic and orchestration. The only layer that calls repositories. Never touch `req`/`res` — take plain arguments, return plain data or throw `AppError`.
- **Controllers**: HTTP translation only. Wrapped in `catchAsync`. No business logic.
- **Dependencies are wired via each module's `container.js`** (manual factory-function DI — see `docs/adr/0006-manual-dependency-injection.md`), never via a service directly `require()`-ing a repository.

Full detail and a table of what each layer may/may not import: `docs/coding-standards.md` §3.

---

## Coding expectations

- `camelCase.js` files, `PascalCase.js` reserved for classes. Layer-suffix convention (`*.controller.js`, `*.service.js`, etc.) — see `docs/coding-standards.md`.
- `async/await` only, no mixed callback style.
- Every `catch` handles meaningfully or rethrows — **never** an empty or silently-swallowing catch block.
- Comments only when the *why* isn't obvious from the code (a non-obvious constraint, an external-system quirk, a workaround). Never restate what the next line does.
- JSON fields `camelCase`, DB columns `snake_case`, mapped in `models/` row-mappers — never let one convention leak into the other's layer.
- Zod validators (`validators/`) handle shape/type/presence; **business** validation (policy rules requiring a DB lookup) lives in the service layer. The `validate(schema)` middleware replaces `req.body` with the parsed result — that parsed object is the DTO; don't invent a separate DTO class layer on top of it.

---

## Security expectations — non-negotiable

Full detail: `docs/security.md`. The load-bearing points:

- **No secret ever reaches a frontend.** `CLICKUP_API_KEY` and all other secrets are read only via `config/index.js` (the only file allowed to touch `process.env`), used only server-side. This is the exact vulnerability class that existed in the original Employees Portal — do not reintroduce it in any form, including "just for local dev" or "just temporarily."
- **Access tokens live in frontend memory, never `localStorage`, never a cookie.** Refresh tokens are the only cookie-carried secret (httpOnly, Secure, SameSite=Lax), scoped to `/api/auth/refresh` only. This split is what makes the auth model CSRF-resistant — don't "simplify" it back to both-in-cookies or both-in-localStorage without understanding what that removes (`docs/adr/0002-authentication-architecture.md`).
- **No permissive CORS.** The app is same-origin by design (one deployable serves the API and both frontends) — it needs no CORS configuration for its own frontends. `cors({ origin: true, credentials: true })`, which existed in the original Pricing Portal, is a vulnerability, not a convenience — never reintroduce it.
- **All SQL is parameterized** via Knex's query builder or `db.raw('...?', [params])`. Never string-concatenate user input into a query.
- **Revoke, never delete**, for any user or employee-roster row with associated history (leave requests, deductions, audit entries). Foreign keys default to `ON DELETE RESTRICT` specifically to make an accidental hard delete fail loudly instead of cascading.
- **Any multi-table write is wrapped in a Knex transaction.** See the enumerated boundaries in `docs/database.md` §4 before assuming a new operation doesn't need one.
- **Any significant action calls `auditService.record(...)`** — role/permission changes, salary edits, approvals, revocations, manager reassignment. See `docs/architecture.md` §8.

---

## Testing expectations

- Unit tests for services (business logic), using the DI factories to pass plain mock objects — no `jest.mock` path interception needed. Full detail: `docs/testing.md`.
- Integration tests (Supertest against the real `app.js`, real test Postgres database) for critical paths: full auth flow, leave-request submission with policy validation, authorization boundaries between modules, the approve/reject conflict path.
- CI (lint, unit, integration, `npm audit`) gates every merge. A change without a passing CI run is not done.

---

## How to add a new module

1. Create `src/modules/<name>/` with `controllers/`, `services/`, `repositories/`, `models/`, `validators/`, `errors.js`, `routes.js`, `container.js`.
2. Own its own tables in the shared Postgres database (module-prefixed or clearly-named — check `docs/database.md` for the existing naming pattern).
3. Zero direct imports from other modules' internals. If it needs something from another module, that's a design conversation (an explicit interface, not a reach-through import) — not a default to reach for.
4. Mount its `routes.js` in `src/app.js` under `/api/<module-name>`.
5. Add its permission strings to `common/constants/permissions.js` if it introduces new role-gated actions.
6. Write it up: update `docs/architecture.md` §2's module list, and add an ADR if the module introduces a genuinely new architectural decision (not just "more of the same pattern").

---

## Practices that must never be violated

- Never commit a secret, API key, or credential to the repository, in any file, for any reason ("just for testing" included).
- Never read `process.env` outside `config/index.js`.
- Never import another module's `services/`, `repositories/`, or `models/` directly.
- Never construct a service's dependencies inline in a controller or route file — always through that module's `container.js`.
- Never hard-delete a `users` or `employee_roster` row, or any row with retained history — revoke/deactivate instead.
- Never introduce a new response shape that doesn't follow the `{ data }` / `{ error: { message, code, details } }` envelope (`docs/api-guidelines.md`).
- Never add a dependency-injection framework, an ORM, a frontend framework/bundler, Redis, a domain-event system, or API versioning without first reading the relevant ADR in `docs/adr/` — each of these was explicitly considered and deferred with a stated trigger condition. If that trigger condition is genuinely met, propose a new ADR that supersedes the old one; don't silently introduce it.
- Never treat this project's small scale as license to skip the security controls in `docs/security.md` — the data (salaries, HR records, approvals) is sensitive regardless of team size.

---

## Where to look for more detail

| Question | Document |
|---|---|
| Why is the system structured this way? | `docs/architecture.md` |
| Why was a specific major decision made, what were the alternatives? | `docs/adr/` |
| How should I write/name/organize a file? | `docs/coding-standards.md` |
| When should I add an abstraction vs. keep it simple? | `docs/engineering-principles.md` |
| What's the REST/response/error convention? | `docs/api-guidelines.md` |
| What are the security controls and why? | `docs/security.md` |
| What does the frontend structure look like (target state)? | `docs/frontend-architecture.md` |
| What needs a test, and how is it structured? | `docs/testing.md` |
| What's the schema, indexes, transaction boundaries? | `docs/database.md` |
| How do I deploy, migrate, rotate a secret, roll back? | `docs/operations.md` |
| What's the implementation sequence, and what's the current milestone? | `docs/migration-plan.md` |

**Do not begin writing production code changes based on this file alone if `docs/migration-plan.md` hasn't been explicitly approved and a specific milestone hasn't been agreed as the current focus.** This project's process is deliberately staged (architecture review → documentation → migration plan → implementation, milestone by milestone) — check with the user which milestone is active before assuming green light to build.
