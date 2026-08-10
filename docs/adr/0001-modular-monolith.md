# ADR-0001: Modular Monolith over Microservices or Full Rewrite

## Status
Accepted

## Problem
Two internal tools need to become one system: Pricing Portal (a working three-tier app with real auth, Postgres/SQLite persistence, and a granular REST API) and Employees Portal (a single static HTML file with no backend at all, a hardcoded secret exposed in client JS, and client-side-only "authentication"). The organization needs both domains available under one login, with room for future domains (a CRM module was mentioned as plausible), without turning either into unmaintainable spaghetti.

## Decision
Merge both into a **single Express deployable** structured as a **modular monolith**: two (soon three+) domain modules — `pricing`, `employees`, plus a cross-cutting `auth` module — each with its own layered internals (routes → controllers → services → repositories → models), sharing one codebase, one deployment, and one Postgres database with per-module tables, enforced by a strict no-cross-module-import rule rather than physical service boundaries.

## Alternatives considered
- **Full rewrite of both apps from scratch, new architecture for both** — rejected. Pricing Portal's backend architecture is sound; there was nothing wrong with it that justified discarding a working system. Employees Portal contributed no reusable backend architecture regardless of which path was chosen, so a rewrite would have meant redoing Pricing Portal's already-working auth/persistence for zero benefit, plus regression risk to a tool people use daily. (This was decided in a separate, earlier architecture review before this project's Phase 1 began.)
- **Microservices** (separate deployables for Pricing and Employees, communicating over the network) — rejected. This is a single company, small internal user base, no independent scaling or independent team-ownership pressure between the two domains, and no plan for either to be deployed/released independently. Microservices would add real operational cost (service discovery, network failure modes, distributed transactions across what are currently simple same-database multi-table writes) to solve a problem — independent scaling/deployment — that doesn't exist here.
- **Two separate monoliths sharing nothing** — rejected per the explicit decision to consolidate operationally (one login, one deployment) rather than run two apps side by side indefinitely.

## Trade-offs
- A modular monolith's boundaries are enforced by code review and documentation (`docs/architecture.md` §2, `docs/coding-standards.md` §3), not by the network or a build tool — this is cheaper today but requires discipline that doesn't come for free the way a hard service boundary would.
- All modules share one deployment cadence and one failure domain — a bug in `employees` could, in principle, take down `pricing` (e.g. an unhandled exception crashing the process). Mitigated by the error-handling and graceful-shutdown design (`docs/architecture.md` §11, §17), not eliminated.
- Scaling one module independently of another (if `employees` traffic ever vastly outgrows `pricing`) isn't possible without extracting it later — an accepted, explicit deferral, not an oversight.

## Consequences
- New modules (e.g. a future CRM) follow the same pattern: own routes, own tables, own container, zero direct imports from other modules' internals.
- If a genuine need for independent scaling or independent deployment of one module ever arises, that module can be extracted into its own service later — the module boundary discipline (no direct cross-module imports, module-owned tables) is what makes that extraction possible without a rewrite, even though extraction isn't being done now.
