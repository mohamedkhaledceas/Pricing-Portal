# Coding Standards

Concrete, checkable rules. `docs/engineering-principles.md` covers the *judgment* behind when to add or avoid abstraction; this document covers the mechanical conventions that make the codebase predictable to navigate.

---

## 1. File naming

- `camelCase.js` for regular files.
- `PascalCase.js` reserved for classes only (`AppError.js`).
- Layer suffix by convention: `*.controller.js`, `*.service.js`, `*.repository.js`, `*.model.js`, `*.validators.js`, `*.job.js`, `routes.js`, `container.js`. A file's suffix tells you what it's allowed to do (see §3) before you open it.

## 2. Imports

- Plain relative `require()` paths. No path aliases (`~/`, `@/`) — this is a CommonJS project without a bundler, and adding alias resolution (via `module-alias` or similar) is a dependency and a source-map/tooling headache not justified by the win of shorter import paths.
- Import order within a file: node builtins, then third-party packages, then local modules (`common/`, `config/`, then module-relative). Not enforced by a linter rule initially; revisit if it becomes a real point of friction in review.

## 3. Layer rules (mechanical form of `docs/architecture.md` §2, §13)

| Layer | May import | May NOT import |
|---|---|---|
| `routes.js` | its module's `container.js` | repositories, services, DB, `req`/`res` logic beyond wiring |
| `controllers/` | services (via constructor/factory param) | repositories, DB, other modules' controllers |
| `services/` | repositories, `common/`, `utils/` (via factory param) | `req`/`res`, other modules' services/repositories |
| `repositories/` | the DB connection (via factory param) | other modules' repositories, business logic |
| `models/` | nothing but plain data | any layer above it |

A controller that constructs a repository directly, or a service that reads `req.headers`, is a layering violation — flag it in review regardless of whether the code "works."

## 4. Async style

`async/await` throughout. No mixing in raw `.then()` chains or callback-style APIs — wrap any callback-based dependency in a promise at the boundary rather than letting callback style leak into service/controller code.

## 5. Error handling discipline

- Every `catch` block either handles the error meaningfully or rethrows. **Never** `catch (e) { return; }` or an empty catch — this was a real defect in the reference project's own `register` service and is called out explicitly so it isn't repeated.
- Controllers are wrapped in `catchAsync` (`common/error/catchAsync.js`) — no manual `try/catch` boilerplate per controller method.
- Throw `AppError` (via a module's `errors.js` factory) for anything the caller should see a specific message/status for. Let genuinely unexpected exceptions propagate to the centralized `errorHandler` uncaught — don't wrap unknown errors in a generic `AppError` just to "handle" them; that hides real bugs behind a misleadingly clean error response.

## 6. Comments

Default to none. Add a comment only when the *why* isn't obvious from the code itself — a non-obvious constraint, a workaround for a specific external-system quirk (e.g. "ClickUp's API returns 200 with an error field on rate limit, not a 429 — see clickup.client.js retry logic"), or an invariant that would surprise a reader. Never a comment restating what the next line does.

## 7. Linting & formatting

ESLint + Prettier, run in CI (`docs/testing.md` §CI), blocking merge on failure. Neither current project has this configured — introduced as part of this migration. Config specifics (which ESLint ruleset, Prettier options) are an implementation-time decision, not an architectural one; default to a widely-used base config (e.g. `eslint:recommended` + a Node plugin) rather than hand-rolling a custom rule set.

## 8. Naming conventions (data)

- JSON field names: `camelCase` (matches existing frontend expectations in both source apps).
- DB column names: `snake_case` (matches existing SQL style in the current Pricing Portal schema).
- The mapping between the two happens in a module's `models/` row-mapper (`mapRow(row) => ({ startDate: row.start_date, ... })`) — never leak `snake_case` fields into an API response, and never accept `camelCase` directly into a raw SQL query without going through a repository.

## 9. What "done" means for a piece of code in this project

- Passes lint and tests in CI.
- Has a unit test if it's a service (business logic) or a validator with non-trivial rules.
- Has an integration test if it's a new route on a path listed as "critical" in `docs/testing.md`.
- Introduces no new cross-module import (§3, `docs/architecture.md` §2).
- Introduces no new `process.env` read outside `config/index.js` (`docs/security.md` §10).
- If it's a multi-table write, wraps it in a transaction (`docs/database.md` §Transactions).
- If it's a significant action (approval, revocation, salary change, permission change), calls `auditService.record(...)` (`docs/architecture.md` §8).
