# Migration Plan

Breaks implementation into small, independently testable milestones. **The application stays functional and in production use after every milestone** — no milestone is a big-bang cutover of everything at once. Each milestone has its own verification checklist and rollback plan. This plan is written to Phase 4 of the project's process (`docs/migration-plan.md` is a deliverable of the documentation phase); implementation does not begin until this plan itself is approved, per explicit instruction.

---

## Ground rules for every milestone

- Production Pricing Portal (the currently deployed app) keeps serving real users until the milestone that explicitly cuts it over (M3) — and even then, a defined rollback window is kept.
- The standalone Employees Portal (`index.html` hitting ClickUp directly) is left reachable at its current location until its replacement (M5) is verified — because it's a physically separate file with no shared dependency on this project's backend, leaving it in place costs nothing and is the safest possible fallback.
- Every milestone has a **completion criteria** section — a milestone isn't "done" until every item is checked, not just "the code is written."
- Every milestone has a **rollback** section, specific to what that milestone actually changed — not a generic "redeploy the previous commit" for milestones where that wouldn't actually be safe (e.g. after a one-time data migration).

---

## M0 — Tooling & scaffolding (no behavior change)

**Scope:** ESLint/Prettier config, GitHub Actions CI skeleton (lint + placeholder test step), `.env.example`, `config/index.js` (validated env loader, introduced alongside — not yet replacing — existing `process.env` reads in the legacy server), Knex installed with an initial migration that mirrors the **existing SQLite schema** 1:1 into a new Postgres database (staging only, not yet used by any running code).

**Completion criteria:**
- [ ] CI runs lint on every push/PR
- [ ] `npm run migrate` runs cleanly against a fresh staging Postgres database, producing a schema matching the current SQLite schema
- [ ] `.env.example` documents every variable the *current* app already uses
- [ ] Production Pricing Portal deployment and behavior are completely unchanged

**Rollback:** trivial — nothing production-facing changed. Revert the branch.

---

## M1 — New app skeleton, deployed dark

**Scope:** `src/app.js` / `src/server.js` split, `common/logger`, `common/correlation`, `common/error` (AppError, errorHandler, catchAsync), the middleware pipeline (`docs/architecture.md` §9), `GET /health` and `GET /ready`. Deployed as a **new, separate route surface** — mounted alongside the legacy server (e.g. legacy app continues serving `/`, `/api/*` as it does today; the new skeleton is verified via `/health`/`/ready` only, not yet carrying real traffic).

**Completion criteria:**
- [ ] `/health` and `/ready` respond correctly in staging and (once confirmed safe) production
- [ ] Structured JSON logs show correlation IDs end-to-end for a request through the new skeleton
- [ ] Legacy Pricing routes are demonstrably untouched (existing manual smoke test: log in, view a project, edit an expense)

**Rollback:** the new skeleton isn't wired into anything users depend on yet — remove its mount point / redeploy without it.

---

## M2 — Auth module, deployed dark

**Scope:** full `modules/auth` (users, refresh_tokens, user_module_access tables + migrations; signup/login for both Google and password; refresh rotation; revoke; `jwt.js`/`hash.js` inside the module per ADR-0002). Deployed and reachable, but **not yet linked from any frontend** — the legacy Pricing frontend still authenticates against the old SQLite `users` table via the old code path.

**Completion criteria:**
- [ ] Unit tests pass for signup (both methods, including roster-gate rejection — using a stubbed roster for now, since the real roster sync is M4), login, refresh rotation, reuse-detection, revoke
- [ ] Integration tests pass against a real staging Postgres: full flow end-to-end
- [ ] Manual smoke test in staging: create a test user directly in the DB, sign up, log in, refresh, revoke, confirm revoked refresh token is rejected
- [ ] Zero impact on production Pricing Portal (still on legacy auth)

**Rollback:** module isn't linked to anything live — remove its mount point.

---

## M3 — Pricing cutover (highest-risk milestone)

**Scope:** port existing Pricing routes into `modules/pricing` (controllers/services/repositories/models), preserving exact existing behavior and endpoint shapes except for the response-envelope standardization (ADR-0009). One-time data migration: existing SQLite data (`company_settings`, `team_members`, `expenses`, `projects`, `project_lines`, `direct_costs`, `scenarios`, `quote_lines`, and the existing `users` table) → Postgres, with existing Pricing users mapped to the new `users`/`user_module_access` model (role `pricing_user` or `admin` per their existing `user`/`owner` role, granted `pricing` module access). `margin-planner_1.html` updated to call the new API base and unwrap the new envelope shape.

**This is the milestone where production traffic actually moves.** Staged rollout:
1. Deploy to staging, run the one-time data migration against a staging copy of production data, verify thoroughly (checklist below).
2. Schedule a production cutover window. Run the one-time data migration against production data (SQLite → Postgres), deploy the new app pointed at Postgres, keep the legacy SQLite-backed deployable available and ready to redeploy for a defined rollback window (recommend: 2 weeks minimum, given this project has no hard deadline).

**Completion criteria:**
- [ ] Every existing Pricing endpoint (team, expenses, projects incl. lines/direct-costs/scenarios/quote-lines, settings, auth) exercised in staging with real-shaped data
- [ ] All existing Pricing users can log in post-migration with their existing credentials
- [ ] For a sample of real existing projects: quote totals, margin calculations, and capacity figures match pre-migration values **exactly** (not approximately) — this is a financial tool, silent rounding/mapping drift is unacceptable
- [ ] `margin-planner_1.html` renders identically against the new API (manual visual comparison, golden-path + edge cases per the standing instruction to test UI changes in a real browser before calling them done)
- [ ] Multi-table writes (project creation, quote line edits) verified to be transactional (kill a request mid-write in staging, confirm no partial state)
- [ ] Legacy SQLite-backed build confirmed still deployable as a rollback target

**Rollback:** redeploy the previous (legacy, SQLite-backed) build. Because this milestone includes a one-time data migration, rollback also means **any Pricing data changes made after the cutover but before a rollback decision would need to be reconciled manually** — this is the one milestone where rollback isn't purely mechanical, which is exactly why it gets a longer bake window and the most thorough pre-cutover verification of any milestone in this plan.

---

## M4 — Employees roster sync + signup integration

**Scope:** `employee_roster` table, ClickUp roster sync job (`modules/employees/jobs/rosterSync.job.js`, `integrations/clickup.client.js`), `roster_sync_log`. Wires roster-gating into the now-live auth module: Employees staff can sign up and log in, landing on a placeholder/empty Employees page (no leave-request functionality yet — that's M5).

**Completion criteria:**
- [ ] Roster sync job successfully pulls real ClickUp workspace membership in staging and populates `employee_roster` correctly (name, email, clickup_id, department)
- [ ] `roster_sync_log` records each run with accurate counts
- [ ] Signup rejects an email not on the roster; accepts one that is
- [ ] Offboarding detection: removing a test member from the ClickUp workspace results in `employee_roster.active = false` on the next sync, and revokes any linked account's access
- [ ] Zero impact on Pricing (independent module, independent tables)

**Rollback:** disable the sync cron and/or the roster-gate check independently of everything else — Pricing is unaffected either way.

---

## M5 — Employees: leave request submission (core feature go-live)

**Scope:** `leave_requests`, `deductions` tables. Submission endpoint with the full business-rule validation (auto-reject on notice period, WFH quota, clash pairs) ported from the current client-side logic into the service layer. `employees/index.html` updated to call the new API instead of ClickUp directly — **the hardcoded ClickUp API key and all direct ClickUp calls are removed from the frontend entirely** at this point.

**Completion criteria:**
- [ ] **Policy regression test**: the ported auto-reject logic produces identical accept/reject decisions to the current (client-side) implementation for a comprehensive set of test scenarios — same-day requests, WFH quota edge cases, each clash pair, sick-leave timing boundaries. This is copied logic from code that works today but is insecurely placed; the port must be behaviorally identical, verified explicitly, not assumed.
- [ ] Manual QA of the actual submission UI flow against the new backend, for every request type
- [ ] Confirmed via browser dev tools / network tab: no ClickUp API key, no direct ClickUp calls, anywhere in the served frontend
- [ ] Confirmed: submitting a request that should be auto-rejected is rejected server-side even if a client-side check is bypassed (the actual point of this milestone)

**Rollback:** because the old standalone Employees Portal was never deleted and has no dependency on this project's backend, it remains reachable at its original location as an immediate fallback if a serious issue is found — no code rollback required, just redirect usage back to the old URL while the issue is fixed.

---

## M6 — Employees: approvals, hierarchy, revocation, audit logging

**Scope:** approve/reject endpoints (status-guarded conditional update per `docs/database.md` §5), the manager-assignment screen (`manager_employee_id`), revoke endpoints (manager unscoped, hr_admin unscoped, per the confirmed decision), and `common/audit/` wired into every significant action across **all three modules** (including retroactively adding audit calls to Pricing's salary-edit path, which predates this milestone).

**Completion criteria:**
- [ ] Concurrent-approval integration test: two simultaneous approve attempts on the same request, one succeeds, one gets `409 CONFLICT`
- [ ] Audit log entries appear for: leave approval/rejection, revocation, manager reassignment, salary edits (Pricing) — spot-checked against `GET /api/audit-log`
- [ ] A revoked user's existing refresh token is rejected on next use; their existing access token stops working within the accepted 15-minute window
- [ ] Manager can revoke any employee (not just direct reports) per the confirmed decision; approve/reject remains scoped to direct reports — both behaviors explicitly tested

**Rollback:** approve/reject and revoke routes can be disabled independently without affecting M5's submission functionality.

---

## M7 — Security hardening pass

**Scope:** apply `docs/security.md` in full — Helmet, CSP with per-request nonce rendering for the two frontend HTML files, rate limiting (general + stricter on `/api/auth/*`), removal of the legacy permissive CORS config, graceful shutdown (`docs/architecture.md` §17), `npm audit` gating in CI.

**Completion criteria:**
- [ ] Security headers present on all responses (verified via a direct curl/header check, not just "helmet is imported")
- [ ] CORS: cross-origin requests from an arbitrary origin are rejected; same-origin frontend requests work normally
- [ ] CSP: both frontends load and function correctly with the policy active (no console CSP violations for legitimate resources); confirm the nonce-based inline script actually executes
- [ ] Rate limiting triggers correctly on repeated auth attempts without false-triggering on normal usage
- [ ] Graceful shutdown: send SIGTERM during an in-flight request in staging, confirm it completes before the process exits, and confirm the roster-sync cron doesn't fire mid-shutdown
- [ ] `npm audit` (or equivalent) is part of the CI gate and currently passing

**Rollback:** each control is additive middleware — disable individually if one causes an unexpected regression, without affecting the rest.

---

## M8 — Decommission legacy code

**Scope:** remove the old `server/src` (legacy SQLite-backed Pricing app) and the old standalone Employees `index.html` + its embedded ClickUp key, once M3–M7 have been stable in production for an agreed bake period (recommend: at minimum the M3 rollback window, §M3, fully elapsed with no issues).

**Completion criteria:**
- [ ] Explicit sign-off that the bake period has elapsed with no rollback events
- [ ] No remaining references to the legacy SQLite database file or the old standalone Employees frontend anywhere in deployment configuration
- [ ] Final confirmation (via access logs, if available) that no traffic has hit legacy endpoints in the preceding period

**Rollback:** this is the one milestone that is intentionally **not** quickly reversible — which is exactly why it's gated on an explicit bake period and explicit sign-off rather than being bundled into an earlier milestone.

---

## Summary table

| Milestone | Production risk | Depends on | Independently testable |
|---|---|---|---|
| M0 Scaffolding | None | — | Yes |
| M1 App skeleton (dark) | None | M0 | Yes |
| M2 Auth module (dark) | None | M0 | Yes |
| M3 Pricing cutover | **High** — real cutover, one-time data migration | M0-M2 | Yes, extensively staged first |
| M4 Roster sync + signup | Low — new module, isolated | M2, M3 (shared auth) | Yes |
| M5 Leave submission go-live | Medium — new user-facing feature, old app stays as fallback | M4 | Yes |
| M6 Approvals + audit | Low-Medium — extends M5 | M5 | Yes |
| M7 Security hardening | Low — additive controls | M3, M5 | Yes |
| M8 Decommission legacy | Irreversible by design | All prior, + bake period | N/A (cleanup) |
