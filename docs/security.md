# Security

This document is the authoritative list of security controls for the CEAS Portal, what each one defends against, and why it's scoped the way it is. It exists because two real vulnerabilities were found in the source projects during the architecture review — a hardcoded, publicly-exposed ClickUp API key and a permissive CORS configuration that effectively disables CORS protection — and because this system will hold salary and HR data, which raises the bar above "internal tool, don't worry about it."

---

## 1. Threat model, briefly

Internal tool, single company, small trusted user base, but handling genuinely sensitive data (salaries, leave/HR records, KPI evaluations). The realistic threats are: credential theft/reuse, XSS leading to session takeover, CSRF against authenticated actions, accidental secret exposure (the exact failure mode already seen in the current Employees Portal), and SQL injection. Not in scope: nation-state actors, DDoS at scale, multi-tenant isolation (there is one tenant).

---

## 2. Transport & headers

**Helmet** (`app.use(helmet())`) — sets `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, and other baseline headers. Near-zero cost, meaningful default hardening. No reason to skip it.

**Content Security Policy** — configured explicitly (Helmet's CSP module), not left at Helmet's default:
```
default-src 'self'
script-src 'self' https://accounts.google.com 'nonce-<per-request>'
style-src 'self' https://fonts.googleapis.com 'unsafe-inline'
font-src https://fonts.gstatic.com
connect-src 'self'
frame-ancestors 'none'
object-src 'none'
```
**The tension worth naming:** both frontends keep a single inline `<script>` block per the Phase 2 decision to preserve them as single HTML files. A strict CSP normally forbids inline scripts. The resolution: `app.js` serves these two HTML pages through a tiny per-request render (read the file, inject a generated nonce into both the CSP header and the `<script nonce="...">` tag) rather than a raw `res.sendFile()`. This is a small, one-time change to how two files are served — not a framework, not a build step — and it closes the CSP gap properly instead of falling back to `'unsafe-inline'` (which would defeat much of the point). `connect-src 'self'` matters specifically because ClickUp calls are now server-side only — the frontend has no legitimate reason to reach any external API directly anymore.

---

## 3. CORS — an existing vulnerability, not a hypothetical

Today's Pricing Portal: `cors({ origin: true, credentials: true })`. This reflects **any** `Origin` header back as allowed, while also allowing credentialed requests — in practice this means any website on the internet can make a credentialed request to this API from a victim's browser and read the response. It's close to having no CORS protection at all.

**Fix, not tuning:** the merged app is served same-origin (API and both frontends from one Express deployable, per the architecture decision), so the frontends need **no CORS configuration whatsoever** — same-origin requests aren't subject to CORS in the first place. Drop the `cors` middleware entirely. If a legitimate external origin ever needs API access (unlikely for an internal tool, but e.g. a future mobile app or a partner integration), add an explicit, narrow allowlist at that point — never `origin: true`.

---

## 4. CSRF

Cookie-based auth is CSRF-prone because browsers attach cookies to requests automatically, including ones a malicious page triggers. The architecture (see `docs/architecture.md` §4.2) splits tokens specifically to address this:

- **Access token**: JS memory only, sent via `Authorization: Bearer` header. A cross-site attacker can't make the victim's browser set this header — only our own JS, running on our own origin, can. This removes CSRF risk from the large majority of authenticated API calls.
- **Refresh token**: the only cookie-carried secret, scoped to a single endpoint (`POST /api/auth/refresh`). Defended by `SameSite=Lax` (blocks the common cross-site POST vector) and being POST-only (not triggerable by a simple `<img>`/link cross-site GET). This is a narrow enough surface that a double-submit CSRF token is not currently justified — noted as the next escalation if this endpoint is ever found to need it.

---

## 5. XSS — now load-bearing, not just good practice

Because the access token lives in JS memory (§4 above), an XSS vulnerability doesn't just deface a page — it lets injected script read the token directly or make authenticated requests as the victim. This raises XSS from "should fix" to "precondition for the auth model."

**Known risk in the source code:** both current frontends build DOM content by concatenating strings into `innerHTML` in multiple places (e.g. `managerRequestCard`, `kpiRow` in the Employees Portal). Any place user-supplied free text (leave request reasons, KPI comments, names) flows into `innerHTML` unescaped is a stored-XSS vector.

**Rule going forward:**
- Prefer `textContent` over `innerHTML` for any plain-text content.
- Where HTML structure is genuinely needed around dynamic text, build the DOM with `createElement`/`textContent` rather than template-string interpolation, or run dynamic text through a small `escapeHtml()` helper (`common/dom.js` on the frontend, see `docs/frontend-architecture.md`) before interpolating.
- **Escape late, not early**: sanitize/escape at the render boundary, not at input/storage time. Storing pre-escaped data makes it harder to reuse correctly elsewhere (e.g. in an export, a different rendering context, or an email) and is a common source of double-escaping bugs.
- Auditing and fixing existing `innerHTML` usage is part of the frontend migration work, not a deferred nice-to-have — see `docs/frontend-architecture.md`.

---

## 6. SQL injection

All queries go through Knex's query builder (parameterized) or `db.raw('... ?', [param])` with placeholders. **Never** string-concatenate user input into SQL, including inside `db.raw()`. This is a hard rule, not a preference — enforced in code review.

---

## 7. Rate limiting

`express-rate-limit`, two tiers:
- General API: generous limits, mainly a backstop against runaway clients/bugs.
- `/api/auth/*` (login, signup, refresh): tighter limits per IP, specifically to blunt credential-stuffing and brute-force against an internal tool where account lockout policies don't otherwise exist.

---

## 8. Request size limits

`express.json({ limit: '2mb' })` — carried forward from the current Pricing Portal, which already sets this sensibly (accounts for base64-encoded logo uploads in `company_settings`). Endpoints with unusually large legitimate payloads get their own explicit limit rather than raising the global default.

---

## 9. Password policy

- Minimum length ≥10 characters. No forced composition rules (uppercase/symbol requirements) — NIST guidance favors length over composition theater, and composition rules measurably push users toward predictable patterns.
- bcrypt cost factor 12 (reference project used 10; bumped given this now protects HR/salary-adjacent accounts).
- A common-password blocklist check (e.g. top 10k breached passwords) is a reasonable future addition, not essential at current scale — noted, not built.

---

## 10. Secret management

- `config/index.js` is the only file that reads `process.env`; it validates required variables at startup and fails fast if anything is missing.
- `.env.example` checked into the repo with placeholder values (a real gap in both source projects today).
- **Secrets are never logged.** No route handler passes `req.body` wholesale into logger metadata on auth routes (which could include a raw password). Logging calls are deliberate about what metadata they include, not reflexive dumps.
- `CLICKUP_API_KEY` lives only in `modules/employees/integrations/clickup.client.js` (via `config/`) — this is the fix for the current Employees Portal's hardcoded, browser-exposed key. It is never sent to any frontend, ever, under any circumstance.

---

## 11. Dependency vulnerability auditing

`npm audit` (or GitHub Dependabot alerts) run in CI, failing/warning the build on high-severity findings. Cheap to add given CI already exists for tests/lint; there's no reason to skip it.

---

## 12. Input sanitization vs. validation — the distinction

**Validation** (Zod, `docs/api-guidelines.md` §DTOs) ensures data is the right *shape and type*. **Sanitization** neutralizes *dangerous content* within otherwise-valid strings (e.g. a leave request "reason" field is legitimately free text, but shouldn't be allowed to execute as HTML when rendered). These are handled at different layers: validation at the API boundary (reject malformed input outright), sanitization at the render boundary on the frontend (escape late, §5) — not by mangling stored data at write time.

---

## 13. What's explicitly out of scope for now

- Multi-tenant isolation — single tenant, not applicable.
- WAF / DDoS mitigation — internal tool, small user base, not a realistic threat at this stage; revisit if the deployment model ever changes (e.g. public-facing).
- Immediate (sub-15-minute) access revocation — accepted tradeoff for stateless access tokens; see `docs/architecture.md` §4.2 for the option to harden later if a real need arises.
