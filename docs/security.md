# Security

This document is the authoritative list of security controls for the CEAS Portal, what each one defends against, and why it's scoped the way it is. It exists because two real vulnerabilities were found in the source projects during the architecture review — a hardcoded, publicly-exposed ClickUp API key and a permissive CORS configuration that effectively disables CORS protection — and because this system will hold salary and HR data, which raises the bar above "internal tool, don't worry about it."

---

## 1. Threat model, briefly

Internal tool, single company, small trusted user base, but handling genuinely sensitive data (salaries, leave/HR records, KPI evaluations). The realistic threats are: credential theft/reuse, XSS leading to session takeover, CSRF against authenticated actions, accidental secret exposure (the exact failure mode already seen in the current Employees Portal), and SQL injection. Not in scope: nation-state actors, DDoS at scale, multi-tenant isolation (there is one tenant).

---

## 2. Transport & headers

**Helmet** (`app.use(helmet({ contentSecurityPolicy: {...} }))`, `server/src/index.js`, mounted first — before `correlationId`, before any route) — sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Strict-Transport-Security`, and Helmet's other baseline headers, plus an explicit CSP (below). Implemented 2026-09-22, replacing an earlier version of this section that had described this control since 2026-08-10 without it actually existing (confirmed at the time via `git log -S`: no commit had ever touched `helmet`/CSP/`nonce`).

**Content Security Policy** — audited from what the app actually uses (all five frontend surfaces' HTML/CSS/JS read directly, not assumed), not copied from a generic template:
```
default-src 'self'
script-src 'self' 'sha256-<hash>' 'sha256-<hash>' ...
style-src 'self' 'unsafe-inline'
img-src 'self'
font-src 'self'
connect-src 'self'
object-src 'none'
base-uri 'self'
form-action 'self'
frame-ancestors 'none'
```
Narrower than the version originally proposed here: no external script/style/font hosts are allow-listed anywhere because the audit found none in actual use — no Google Sign-In SDK, no Google Fonts, no third-party CDN (auth is email/password only, handled entirely server-side; every `fetch()`/`socket.io` call in every frontend targets a relative, same-origin path).

**Inline `<script>` blocks (theme pre-paint, run before the main module script loads so there's no flash of the wrong theme) are allow-listed by sha256 hash of their exact content, not a nonce.** The content is static per file — it doesn't change per request — so a nonce (which exists specifically to authorize content generated fresh on every response) would be solving a problem that doesn't exist here, at the cost of switching every page from `res.sendFile()` to a per-request template render. A hash needs none of that: `server/src/common/csp.js`'s `inlineScriptHashes()` reads each page's real HTML file and computes the hashes **at server boot**, so they can never go stale relative to what's actually being served — unlike a hand-copied hash string, an edited script is automatically re-hashed on the next restart rather than silently mismatching in production. This is also why the placeholder hashes above aren't filled in: they're computed, not authored, and copying today's values into this doc would just create a second place for them to go stale.

**`style-src` includes `'unsafe-inline'`, deliberately, for now.** Zero inline `<style>` blocks exist, but `pricing`'s markup alone has ~90 inline `style="..."` attributes (mostly one-off `height`/`cursor` declarations) — eliminating those is a real but separate frontend cleanup, out of scope for adding CSP. Style-based injection is a much lower-severity CSP gap than script-based (no arbitrary JS execution path through a `style` attribute in any current browser), so this is a deliberate, scoped trade-off, not an oversight.

**Verified live in a real browser** (not just "should work"): both `/planner` and `/` (employees), across Dashboard/Settings/Quotation-with-live-preview and Overview/KPIs respectively — zero console errors, zero CSP violation reports, every asset (external scripts, `/shared/*` widgets, `socket.io`, the logo image) loading normally.

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

**Historical risk, since audited and fixed:** the early Employees Portal frontend built DOM content by concatenating strings into `innerHTML` in multiple places (e.g. `managerRequestCard`, `kpiRow`) — any user-supplied free text (leave request reasons, KPI comments, names) flowing into `innerHTML` unescaped is a stored-XSS vector. An earlier session audited and fixed this across the frontends that existed at the time; surfaces migrated since (`pricing`) followed the same discipline from the start. See `docs/frontend-architecture.md` §5 for the current state.

**Rule going forward:**
- Prefer `textContent` over `innerHTML` for any plain-text content.
- Where HTML structure is genuinely needed around dynamic text, build the DOM with `createElement`/`textContent` rather than template-string interpolation, or run dynamic text through the small `escapeHtml()`/`esc()` helper every surface's own `dom.js` provides (each surface has its own copy, not one shared file — see `docs/frontend-architecture.md` §3) before interpolating.
- **Escape late, not early**: sanitize/escape at the render boundary, not at input/storage time. Storing pre-escaped data makes it harder to reuse correctly elsewhere (e.g. in an export, a different rendering context, or an email) and is a common source of double-escaping bugs.
- Any new dynamic-rendering code is held to this from the start, not audited in later — see `docs/frontend-architecture.md` §5.

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
