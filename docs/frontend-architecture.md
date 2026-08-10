# Frontend Architecture

The backend gets a full layered architecture in this migration. The frontend does not get rebuilt in the same pass — both `pricing/index.html` and `employees/index.html` stay single HTML files for the initial migration, per an explicit decision made during Phase 1: the priority was minimizing regression risk on two UIs people use daily, not a frontend rewrite. That decision still stands.

This document defines the **target** frontend architecture — what "modular, as Pricing and Employees continue growing" actually looks like — and is explicit about the fact that migrating either frontend into this structure is its **own later initiative**, separate from and not blocking the backend migration milestones in `docs/migration-plan.md`.

---

## 1. Guiding constraint: no framework, no bundler, yet

Both current apps are vanilla JS. Introducing React/Vue/Svelte now would be a much bigger scope change than anything else in this migration, and nothing about the current UI complexity demands it — the apps are large but not architecturally complex (form handling, list rendering, tab switching). **Decision: native ES modules (`<script type="module">`), no bundler, no framework**, for now. Modern browsers support ES modules natively; this gets real file-based modularity without adding build tooling. If module count or performance ever genuinely demands a bundler (esbuild is the lightweight option if that day comes) or a framework, that's a deliberate future decision with its own trigger condition — not something to reach for preemptively.

---

## 2. Folder organization

```
public/
  shared/
    js/
      apiClient.js   # fetch wrapper: base URL, Authorization header, 401 -> silent refresh -> retry
      auth.js          # login/signup/logout calls, in-memory access-token holder, page-load silent refresh
      dom.js             # escapeHtml(), small safe DOM helpers, setLoading()
      state.js             # minimal pub/sub helper (not a framework) for page-scoped state
      format.js              # currency/date formatting shared across pricing/employees
    css/
      base.css              # shared tokens/reset, if/when visual consistency across the two apps matters

  pricing/
    index.html
    js/
      main.js            # entry point: imports shared/*, wires up the page
      team.js, projects.js, quotes.js, capacity.js, ...   # feature-scoped modules

  employees/
    index.html
    js/
      main.js
      overview.js, timeOff.js, today.js, history.js, kpi.js, ...
```

Feature modules are organized by UI section (mirroring the tabs/pages each app already has), not by an attempt to mirror the backend's module boundary one-to-one — the frontend's natural seams are pages/sections, not domains.

---

## 3. API client organization

One `apiClient.js`, shared between both apps (identical concerns: auth header, refresh, error normalization):

- Holds the access token as a **module-scoped variable** — not `window.*`, not `localStorage` (see `docs/security.md` for why: this is the design that makes the access token CSRF-resistant, and it's void if the token gets written somewhere else "for convenience").
- Wraps `fetch`: attaches `Authorization: Bearer <token>` automatically.
- On a `401`, attempts exactly one silent `POST /api/auth/refresh` (cookie-based, no explicit token needed), retries the original request once with the new token. If refresh also fails, clears in-memory state and redirects to login.
- **On page load**, always attempts a silent refresh first. This is what makes "seamless while the session is valid" actually work across page reloads: the access token lives only in memory and is lost on every reload, but the httpOnly refresh cookie persists, so the very first thing the page does is silently exchange it for a fresh access token.
- Normalizes every response into the backend's envelope shape (`docs/api-guidelines.md` §5) so UI code always branches on `{ data }` / `{ error: { code } }`, never on ad-hoc per-endpoint shapes.

---

## 4. Authentication flow (frontend side)

```
Page load
  → apiClient attempts silent refresh
      success → access token in memory, render authenticated UI
      failure → render login screen (Google button + email/password form)

Login (either method)
  → access token stored in memory, refresh cookie set by server
  → render authenticated UI

Any API call returning 401
  → apiClient attempts one silent refresh
      success → retry original call transparently
      failure → clear memory, redirect to login

Logout
  → POST /api/auth/logout (revokes refresh token server-side)
  → clear in-memory access token
  → render login screen
```

`auth.js` owns this state machine; feature modules never touch tokens directly, they only call `apiClient` methods and handle the `data`/`error` result.

---

## 5. XSS discipline (see also `docs/security.md` §5)

Because the access token lives in frontend memory, an XSS bug is no longer just a UI defacement risk — it's a session-takeover risk. `dom.js` provides `escapeHtml()` and prefers `textContent`-based helpers over raw `innerHTML` interpolation. **Auditing and fixing the existing `innerHTML` string-concatenation patterns in both current apps (e.g. `managerRequestCard`, `kpiRow`) is part of migrating a page into this structure** — not a follow-up ticket. A feature module isn't considered migrated until its dynamic rendering goes through the safe helpers.

---

## 6. Routing

Neither app needs a client-side router. Employees Portal's "tabs" (Overview / Time Off / Today / History / Leave Rules / KPI) are DOM show/hide within a single page, not real navigation — that pattern is kept as-is. If deep-linking to a specific tab becomes a real requirement, simple hash-based routing (`#overview`, `#time-off`) is sufficient without pulling in a router library.

---

## 7. State management

No Redux, no global store library. Each page's `main.js` owns one plain state object for that page; feature modules read/write it and re-render the DOM sections they own. `state.js` provides a minimal pub/sub helper (a few dozen lines — subscribe/publish, nothing more) for the cases where one module's state change needs to trigger a re-render in another (e.g. approving a leave request in the manager panel should update the overview counts). This formalizes a pattern both current apps already use informally (a global `state` object plus `render*()` functions) rather than introducing a new paradigm — lower risk, lower learning curve, matches the existing mental model.

---

## 8. Loading states & error handling

Shared conventions via `dom.js`:
- `setLoading(container, boolean)` — shows/hides a loading indicator for an async region. Both current apps already have ad-hoc versions of this (`showLoading`/`hideLoading` in Employees Portal) — formalized into one shared helper.
- Errors surface via a shared toast/banner helper that reads the backend's `{ error: { message, code } }` shape. UI code can branch on `code` for specific handling (e.g. `CONFLICT` on an approve action means "someone else already acted on this, refresh the list") while falling back to displaying `message` for anything it doesn't specifically handle.

---

## 9. Future scalability

This structure scales by adding feature modules as pages grow — no architectural ceiling within "vanilla JS app with a few dozen focused files." The explicit trigger conditions for revisiting the no-framework/no-bundler decision:
- Module count or interdependency grows to where manual DOM diffing/re-rendering becomes error-prone (a sign a reactive framework would pay for itself).
- Real client-side routing/deep-linking becomes a hard requirement across many views.
- Bundle-time concerns (many small files, no HTTP/2 multiplexing in some deployment context) make a lightweight bundler (esbuild) worth the added build step.

None of these apply today. Documenting them here so the decision to introduce a framework later is made deliberately, against a stated trigger, not reactively mid-feature.
