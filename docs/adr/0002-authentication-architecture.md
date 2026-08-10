# ADR-0002: Dual-Method Roster-Gated Auth with Split Token Storage

## Status
Accepted

## Problem
Pricing Portal used admin-created username/password accounts (bcrypt + a single 2-hour JWT, no refresh, token in `localStorage`). Employees Portal used entirely client-side Google Sign-In: the browser decoded the Google JWT itself, matched the email against a hardcoded map in the page's own source, and never involved a server in the identity decision at all — meaning the "authentication" was cosmetic and trivially bypassable via devtools. Neither pattern was acceptable as the foundation for a merged system that would hold HR and salary data, and the client wanted self-service signup (no admin burden creating accounts) without opening registration to anyone on the internet, plus a specific hybrid login UX (Google or password, persistent sessions, seamless silent re-login).

## Decision
- **Identity verification is always server-side**: Google ID tokens are verified against Google's public keys server-side (never trusting a client-decoded payload); passwords are bcrypt-hashed and checked server-side.
- **Signup is self-service but roster-gated**: an `employee_roster` table, kept in sync automatically from ClickUp workspace membership (a scheduled server-side job), is the only source of truth for "is this a legitimate CEAS employee." Signup (via either Google or email+password) succeeds only if the submitted email matches an active roster entry. No admin ever manually creates an account or distributes a password.
- **Dual signup/login methods, both always available**: a user can sign up and log in with either Google or email+password; the login screen always offers both.
- **Split token storage**: access token (15 min, JWT) lives in frontend memory only, sent via `Authorization: Bearer`; refresh token (30 days, opaque, rotated on use) lives in an `httpOnly`, `Secure`, `SameSite=Lax` cookie, used only against `/api/auth/refresh`.
- **Manager hierarchy is a separate concern from roster sync**: since ClickUp has no standing reporting-line field, `manager_employee_id` is set via a small dedicated in-portal screen (P&C/admin only) — the one place a human still touches the portal directly for onboarding, deliberately narrow in scope (an org-chart edit, not credential management).

## Alternatives considered
- **Admin-provisioned accounts** (original default assumption) — explicitly rejected by the client mid-design: burdens P&C with generating and distributing credentials for every hire, which was called out as bad UX worth solving properly rather than accepting.
- **Fully open signup with post-hoc approval queue** — rejected in favor of roster-gating, because roster-gating requires zero ongoing manual action from P&C (it's a byproduct of onboarding they already do in ClickUp) while still preventing arbitrary signups, whereas an approval queue would reintroduce a manual per-signup step.
- **Both tokens in httpOnly cookies** (the original Phase 2 draft) — superseded during the Principal Engineer hardening review. HttpOnly cookies alone don't address CSRF (the browser attaches them automatically to any request, including attacker-triggered ones); splitting storage gives each token the protection it actually needs (see `docs/security.md` §CSRF).
- **Domain-based gating (`@theceas.com` only, no roster)** — rejected: several legitimate employees use personal Gmail addresses; a domain check alone can't express that, and a roster (already needed for the manager-hierarchy and HR-data reasons above) solves both problems with one mechanism.

## Trade-offs
- Roster-gated signup makes the ClickUp sync job load-bearing for onboarding — if it breaks silently, new hires can't sign up. Mitigated by `roster_sync_log` (`docs/database.md`) making sync failures visible and checkable.
- Access-token-in-memory means every page reload requires a silent refresh round-trip before the UI is usable — a small, acceptable latency cost, not a UX regression given it's transparent to the user.
- The access-token-in-memory CSRF mitigation is only as good as the frontend's XSS resistance — this created a new, explicit dependency (`docs/security.md` §5) that didn't exist under the original all-cookies design, in exchange for meaningfully better CSRF resistance overall.

## Consequences
- Revocation (offboarding, manual revoke) is not instantaneous — a revoked user's existing access token remains valid for up to 15 minutes. Documented and accepted (`docs/architecture.md` §4.2); revisit only if a real incident demonstrates this window is a problem in practice.
- `users.is_active` (login/access) and `employee_roster.active` (HR employment status) are intentionally separate flags — offboarding cascades access revocation, but access can be revoked independently of employment status (e.g. a security incident) without that being an HR action.
