# Testing Strategy

Neither source project has any automated tests. This is the baseline for the new codebase, decided in Phase 1 and unchanged by the hardening review: **unit tests for services, integration tests for critical routes, CI-gated.** Not full coverage everywhere — targeted at the paths where a silent regression would actually hurt (auth, money, HR policy enforcement).

---

## 1. Unit tests — services

**What gets tested:** every service method containing business logic. This is where the risk lives — the leave auto-reject policy (notice periods, WFH quota, clash pairs), KPI scoring math (once built), auth token issuance/rotation, roster-gating on signup, and the manager/hr_admin authorization scoping distinctions (`docs/architecture.md` §5.4).

**How, given the DI approach (`docs/architecture.md` §3):** services are factory functions taking dependencies as parameters, so tests construct them with plain mock objects — no `jest.mock` module-path interception needed:

```js
const createLeaveRequestService = require('../../../src/modules/employees/services/leaveRequest.service');

test('rejects same-day PTO request', async () => {
  const mockRepo = { create: jest.fn(), findOverlapping: jest.fn().mockResolvedValue([]) };
  const service = createLeaveRequestService({ leaveRequestRepository: mockRepo, auditService: { record: jest.fn() }, logger: silentLogger });

  const result = await service.submitRequest({ type: 'pto', startDate: today, ... }, actingUser);

  expect(result.status).toBe('auto_rejected');
  expect(mockRepo.create).not.toHaveBeenCalled();
});
```

**What does NOT get unit tests:** repositories (thin data access — tested indirectly via integration tests against a real database, where a mock would just be re-asserting the mock's own behavior), controllers (thin translation layer — covered by integration tests instead), route wiring (covered by integration tests).

---

## 2. Integration tests — critical routes

**Runs against the real `app.js`** (the split from `server.js` in `docs/architecture.md` §1 exists specifically so this works — Supertest imports `app` directly, no port binding needed) and a **real test Postgres database** (dedicated schema or database, migrated fresh before the suite runs, truncated between test files — not mocked, because the point is verifying the actual SQL, transactions, and constraints behave as designed).

**Critical paths covered:**
- Full auth flow: signup (both methods, including roster-gate rejection) → login → refresh (including rotation-reuse detection) → logout.
- Leave request submission end-to-end, including the auto-reject policy actually running before anything is persisted.
- Approve/reject with the status-guard conflict behavior (`docs/database.md` §Optimistic Locking) — two concurrent approve attempts, one must get `409 CONFLICT`.
- Authorization boundaries: a `pricing_user` hitting an `/employees/*` route gets `403`, not a silent empty response.
- Revocation: a revoked user's existing refresh token no longer works.

---

## 3. Test database

Separate Postgres database/schema from dev, created and migrated via the same Knex migration files used in production (§ `docs/operations.md`) — never a hand-maintained parallel schema that can drift from the real one. Truncated (not dropped/recreated) between test files for speed; full migration run once per CI job.

---

## 4. CI

GitHub Actions, on every push and PR:
1. Install dependencies.
2. Spin up a Postgres service container.
3. Run migrations against it.
4. Run lint (`docs/coding-standards.md` §7).
5. Run unit tests.
6. Run integration tests.
7. `npm audit` (`docs/security.md` §11).

Any failure blocks merge. This is new for both source projects — introduced as part of this migration, not an afterthought bolted on later.

---

## 5. What "needs a test" actually means in review

From `docs/coding-standards.md` §9: a service method with any conditional business logic needs a unit test covering at least the branches that matter (the happy path and the policy-rejection paths, not necessarily every permutation). A new route on an auth, money, or HR-policy path needs an integration test. A new route that's a straightforward CRUD passthrough with no interesting logic (e.g. `GET /pricing/expenses`) doesn't need a bespoke integration test beyond what already exercises the auth/authorization middleware generically — don't write a test whose only assertion is "the mock was called," which is testing the mock, not the code.

---

## 6. What this strategy deliberately does not include (yet)

- **End-to-end browser tests** (Playwright/Cypress) against the actual frontend — not introduced now. The frontends stay single HTML files for this migration (`docs/frontend-architecture.md`); E2E tooling is worth adding once the frontend has enough structure (per that document) to make E2E tests maintainable rather than brittle. Manual verification checklists (`docs/migration-plan.md`) cover frontend correctness for now.
- **Load/performance testing** — not justified at current scale; revisit if the caching/scaling triggers in `docs/architecture.md` §15 are ever hit.
- **Mutation testing, coverage-percentage gates** — coverage percentage as a target tends to produce tests that exist to hit a number rather than to catch real regressions; this project measures test value by "does this cover a risky path," not by a coverage threshold.
