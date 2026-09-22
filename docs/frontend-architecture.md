# Frontend Architecture

This document originally defined a **target** frontend architecture to migrate toward, separate from and not blocking the backend module migration in `docs/migration-plan.md`. That target has since been reached: as of 2026-09-22, all four browser-facing surfaces — `employees`, `commercial-leads`, `ceo-dashboard`, and `pricing` (plus the `auth` module's `/login` page) — use the same `views/{index.html, css/*.css, js/*.js}` structure described below. `docs/architecture.md` §10 has the up-to-date, authoritative summary and the history of how each surface got there (`pricing` was the last holdout, a single ~2,779-line file until 2026-09-21/22); this document describes the resulting conventions in more detail. If the two ever disagree, `docs/architecture.md` wins.

---

## 1. Guiding constraint: no framework, no bundler

All five surfaces are vanilla JS. Introducing React/Vue/Svelte would be a much bigger scope change than anything else in this app, and nothing about the current UI complexity demands it — every surface is large but not architecturally complex (form handling, list rendering, tab switching). **Decision: native ES modules (`<script type="module">`), no bundler, no framework.** Modern browsers support ES modules natively; this gets real file-based modularity without adding build tooling. If module count or performance ever genuinely demands a bundler (esbuild is the lightweight option if that day comes) or a framework, that's a deliberate future decision with its own trigger condition (§9) — not something to reach for preemptively.

---

## 2. Folder organization

Each browser-facing module owns its frontend under its own `views/` directory — there is no top-level `public/pricing/`, `public/employees/`, etc.:

```
server/src/modules/
  auth/views/
    index.html
    css/login.css
    js/{main,dom,theme}.js

  employees/views/
    index.html
    css/employees.css
    js/{main,apiClient,dom,state,theme,overview,timeOff,team,roster,...}.js   # 20 feature-scoped modules

  management/commercial-leads/views/
    index.html
    css/commercialLeads.css
    js/{main,apiClient,dom,state,theme,deals,charts,quarterlyKpis,...}.js

  management/ceo-dashboard/views/
    index.html
    css/ceoDashboard.css
    js/{main,apiClient,dom,state,theme,charts,render}.js

  pricing/views/
    index.html
    css/pricing.css
    js/{main,apiClient,dom,state,theme,calc,recompute,team,expenses,projects,scenarios,quote,dashboard,capacity,settingsPanel,users,history,format}.js

server/public/
  shared/            # genuinely cross-app, non-module <script> widgets — see §3
    accountMenu.js, accountMenu.css, accountSettings.js, orgConstants.js, departments.js
  logo-light.png, logo-dark.png, 404.html
```

Each module's routes file serves its `views/index.html` at its own path and mounts the rest of `views/` as a static directory (e.g. `app.get('/planner', ...)` + `express.static('.../pricing/views')`), the same pattern for all five.

Feature modules within a `js/` directory are organized by UI section (mirroring the tabs/pages each surface already has), not by an attempt to mirror the backend's `routes/controllers/services/repositories` layering — the frontend's natural seams are pages/sections, not domains.

---

## 3. API client organization — one per surface, not shared, by design so far

Each surface has its **own** `apiClient.js` — five near-identical hand-copies, not five callers of one shared module. This is a real, current cost, not a planned structure: two of them (`commercial-leads`, `ceo-dashboard`) independently had the same bug — silently discarding the server's actual error message — until an earlier audit found and fixed it in both places. `employees/apiClient.js` already had the fix; it simply hadn't been shared. Every copy follows the same shape:

- Holds the access token as a **module-scoped variable** — not `window.*`, not `localStorage` (see `docs/security.md`: this is what makes the access token CSRF-resistant, and it's void if the token gets written somewhere else "for convenience").
- Wraps `fetch`: attaches `Authorization: Bearer <token>` automatically.
- On a `401`, attempts exactly one silent `POST /api/auth/refresh` (cookie-based), retries the original request once with the new token. If refresh also fails, clears in-memory state and (on `pricing`, deliberately) redirects to `/login` from anywhere, not just at boot — see the `setSessionExpiredHandler()` injectable-callback pattern in `pricing/views/js/apiClient.js`/`dom.js` for why that one differs from the others' weaker "just throw and let the caller handle it."
- Parses the backend's real response shape: a flat `{ error: "<message>" }` string on failure (see `docs/architecture.md` §8 — **not** the nested `{ error: { message, code, details } }` shape `docs/api-guidelines.md` describes; that guideline was never adopted). Success responses have no consistent envelope either — each endpoint returns its own resource key (`{ team: [...] }`, `{ employees: [...] }`, etc.), so UI code branches per-endpoint, not on a common `{ data }` key.

**Genuine cross-app sharing already exists**, just not for this layer: `server/public/shared/` (`accountMenu.js`/`.css`, `accountSettings.js`, `orgConstants.js`, `departments.js`) is loaded as plain non-module `<script>` tags that attach to `window.*`, included by every frontend for the account menu, org-wide constants, and department lists. Extending this same directory to cover `apiClient.js`/`dom.js` (or converting those specific files to ES modules importable by absolute path — same-origin, so the browser supports that fine) is the natural next step if the five-copy duplication ever causes a real bug again, not a new pattern to invent.

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

Each surface's own `apiClient.js` (plus `main.js`'s boot sequence) owns this state machine; feature modules never touch tokens directly — they only call `apiClient` functions and handle the result.

---

## 5. XSS discipline (see also `docs/security.md` §5)

Because the access token lives in frontend memory, an XSS bug is a session-takeover risk, not just a defacement risk. Every surface's `dom.js` provides an `escapeHtml()`/`esc()` helper, and dynamic rendering goes through it rather than raw `innerHTML` string interpolation of unescaped values. An earlier session's audit fixed the `innerHTML` concatenation patterns that predated this convention (`managerRequestCard`, `kpiRow`, and others); new feature modules are expected to use the safe helper from the start, not as a follow-up.

---

## 6. Routing

No surface needs a client-side router. Tabs (e.g. Employees' Overview / Time Off / Today / History / Leave Rules / KPI, or Pricing's 8 nav tabs) are DOM show/hide within a single page, not real navigation. `pricing` and a couple of others support a `?open=...` query-param deep link into a specific panel/modal on load, handled directly in `main.js` — the closest thing to routing any surface has, and sufficient so far. If real hash-based deep-linking (`#overview`, `#time-off`) becomes a hard requirement, that's enough without pulling in a router library.

---

## 7. State management

No Redux, no pub/sub framework, no shared `state.js`. Each surface's own `state.js` exports one plain mutable object (e.g. `export const state = { accessToken: null, currentUser: null, mainTab: 'overview', ... }`); feature modules import it directly, mutate the fields they own, and call that surface's own `render*()`/`recompute()` functions to reflect the change — no publish/subscribe indirection. This is simpler than the pub/sub helper originally envisioned here, and matches what every surface actually converged on independently. Where one feature module's state change needs to trigger another module's re-render without a circular import between them, the established solution is an **injectable-handler pattern**: the dependent function (e.g. `pricing`'s `recompute()`, `applyMode()`, `renderAllStructures()`) is exposed from a shared low-level file (that surface's `dom.js`) as a plain function whose real implementation is registered once, at boot, by whichever file actually owns it. See `pricing/views/js/dom.js` for the concrete pattern if introducing a new cross-module trigger elsewhere.

---

## 8. Loading states & error handling

No shared helper file for this — each surface's own `dom.js`/inline handlers implement it locally (e.g. a `showSaveError`/`showSaveOk` pair, or a skeleton-block helper for list loading), following the same shape without importing from one another. Errors surface from whatever the backend's flat `{ error: "<message>" }` string says (§3) — there is no `code` field to branch on; UI code shows the message as-is or maps a small number of known strings to friendlier copy where that already existed.

---

## 9. Future scalability

This structure scales by adding feature modules as pages grow — no architectural ceiling within "vanilla JS app with a few dozen focused files per surface" (`pricing`, the largest, has 17). The explicit trigger conditions for revisiting the no-framework/no-bundler decision:
- Module count or interdependency grows to where manual DOM diffing/re-rendering becomes error-prone (a sign a reactive framework would pay for itself).
- Real client-side routing/deep-linking becomes a hard requirement across many views.
- Bundle-time concerns (many small files, no HTTP/2 multiplexing in some deployment context) make a lightweight bundler (esbuild) worth the added build step.
- The five near-identical `apiClient.js`/`dom.js` copies (§3) drift into a third independently-discovered bug — the trigger for finally promoting them into `server/public/shared/`.

None of these apply today. Documenting them here so a decision to introduce a framework, router, bundler, or shared client layer later is made deliberately, against a stated trigger, not reactively mid-feature.
