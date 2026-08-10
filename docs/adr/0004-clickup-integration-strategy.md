# ADR-0004: Own Database as Source of Truth, ClickUp Server-Side Only

## Status
Accepted

## Problem
Employees Portal's entire data layer *was* ClickUp — every leave request, status, and field lived in ClickUp tasks, accessed directly from the browser via a hardcoded, publicly-exposed API key (`pk_54027603_...`, found in the page's own client-side JavaScript). This meant: (1) a live, working secret exposed to anyone who viewed page source, with full read/write access to the company's ClickUp workspace; (2) the app's core functionality (leave requests, HR records) was entirely dependent on a third-party API's uptime, rate limits, and data shape; (3) business-rule validation (notice periods, auto-reject conditions, WFH quotas) ran client-side and was trivially bypassable via devtools, since nothing server-side ever checked it.

## Decision
- The application's **own PostgreSQL database becomes the source of truth** for leave requests, deductions, and HR records going forward.
- **All ClickUp access moves server-side**, confined to `modules/employees/integrations/clickup.client.js`. The API key is read only from `config/` (environment variable), never sent to any frontend, ever.
- ClickUp is still called server-side for two purposes: (1) the roster sync job (`docs/adr/0002-authentication-architecture.md`), pulling workspace membership to gate signup; (2) live presence status (online/offline/meeting/focusing) for the "Today" view, per the client's explicit choice in Phase 1 to keep pulling that specific data point from ClickUp rather than building an in-portal presence system.
- Business-rule validation (auto-reject policy, clash rules, handover gating) runs in the service layer, server-side, before anything is persisted — matching the User Story's explicit acceptance criterion that policy violations must be rejected "before reaching ClickUp."

## Alternatives considered
- **Keep ClickUp as source of truth, backend just proxies it** — considered and rejected in Phase 1. This would have fixed the secret-exposure problem (key moves server-side) and the validation-bypass problem (validation moves server-side) with less schema design work up front, but would leave core functionality permanently dependent on a third-party API's availability, rate limits, and data model — a real, ongoing constraint for zero corresponding benefit once the app has its own database anyway.
- **Drop ClickUp entirely, immediately** — not chosen; presence status is still explicitly sourced from ClickUp per the client's decision, and the option to continue mirroring approved requests into ClickUp for visibility (if staff are used to checking it there) is left open as an optional, non-blocking addition — see `docs/architecture.md` §21.

## Trade-offs
- Owning the data means owning the schema design and migration work for leave requests, deductions, and (eventually) KPI data — real upfront cost, avoided entirely if ClickUp had stayed the source of truth.
- The app still has a live dependency on ClickUp for presence status specifically — if ClickUp's API doesn't cleanly expose "online/meeting/focusing" the way the User Story assumes, that's a gap to resolve during implementation of that specific (backlog) feature, not a reason to reconsider this ADR's scope.

## Consequences
- No secret ever reaches a browser again — closes the most severe finding from the original two-project review.
- Leave-request reporting/querying is no longer bounded by what ClickUp's API supports (arbitrary SQL queries against owned tables, vs. whatever ClickUp's task-search API allows).
- If ClickUp is ever fully retired as a dependency, only `clickup.client.js` and the two call sites that use it (roster sync, presence) need to change — nothing else in the system references ClickUp directly, by construction of the module boundary.
