# Engineering Principles

This document explains the judgment behind the rules in the other documents — the "why" that lets a future engineer (or a future Claude session) make a good call in a situation this documentation didn't explicitly anticipate. `docs/coding-standards.md` is the mechanical checklist; this is the philosophy that produced it.

---

## 1. The five-to-ten-year test

Every decision in this project is evaluated against one question: **will an engineer who has never seen this codebase be able to understand it, trust it, and safely extend it, years from now, without anyone who built it still being around?** This is why the documentation is as extensive as the code — a well-architected system that nobody can understand the reasoning behind degrades into a poorly-architected one the first time someone "fixes" a deliberate constraint they didn't know was deliberate.

## 2. Simplicity is the default; abstraction is earned

This project came from two source codebases with very different problems: Pricing Portal was under-abstracted in places that mattered (no service layer, no module boundary) but never over-engineered. Employees Portal had no backend architecture at all. Neither source project's failure mode was "too much abstraction." The failure mode to actively guard against here is the opposite one — introducing structure this project doesn't need yet because it's the kind of thing "good architecture" is supposed to have.

**The test for any abstraction (a new layer, a new pattern, a new generalized mechanism): does it solve a problem that exists right now, or one that might exist someday?** If it's "might," it doesn't get built now — it gets a note (an ADR marked "deferred," a trigger condition documented) so it's a deliberate future decision, not a forgotten one. Concrete examples from this project's own review:

- **Domain events**: deferred. One current consumer (audit logging) doesn't justify an event system — see ADR-008. Trigger to revisit: a second independent consumer of the same state change appears.
- **Full permission-based authorization**: deferred in favor of role-based checks expressed as permission strings. See ADR-005. Trigger to revisit: a real requirement for per-user permission overrides that role membership can't express.
- **Redis/distributed caching**: out of scope. Trigger to revisit: the app runs more than one instance and needs shared cache state, or a specific expensive query is identified that an in-process cache can't handle.
- **A frontend framework/bundler**: out of scope. Trigger to revisit: documented in `docs/frontend-architecture.md` §9.

Notice the shape of each of these: not "we're against X forever," but "X isn't justified by anything that exists today, and here's exactly what would justify it." That's the difference between disciplined simplicity and just refusing to plan ahead.

## 3. Prefer explicit over clever

Manual dependency injection via factory functions (ADR-006) over a DI container; permission strings resolved through a plain object literal (ADR-005) over a rules engine; a status-guarded `UPDATE` (`docs/database.md`) over general optimistic locking — in each case, the simpler, more explicit mechanism was chosen over the more powerful, more "correct-looking" one, because the explicit version is something a new engineer can understand by reading it top-to-bottom, while the powerful version requires understanding a framework or pattern first. Cleverness that requires tribal knowledge to safely modify is a long-term liability, even when it's technically more capable.

## 4. Change the representation before you need the capability

Several decisions in this project follow the same shape: keep the *implementation* simple now, but choose a *representation* that won't need to change when the requirements grow. The permission-string authorization model is the clearest example — routes say `authorize('leave:approve')`, not `authorize(['manager', 'hr_admin'])`. Today that permission string resolves through a static in-memory map. If real per-user permission overrides are ever needed, only the resolution mechanism changes (static map → database lookup) — every call site across the codebase stays untouched. The `user_module_access` join table (rather than boolean columns on `users`) is the same move: today there are two modules, but adding a third doesn't require a schema migration to add a column, because the representation was already extensible.

This is different from building the capability itself early (which would be over-engineering) — it's choosing the cheaper of two equally-simple representations, specifically the one that doesn't require touching every call site later.

## 5. Boundaries are enforced by understanding, not just tooling

The module boundary rules (`docs/architecture.md` §2) and layer rules (`docs/coding-standards.md` §3) are enforced by code review and this documentation, not by a build-time tool that fails a cross-module import. That's a deliberate choice for a project this size — a lint rule that blocks `modules/pricing` from importing `modules/employees` is easy to add later if violations start happening in practice, but isn't worth the setup cost pre-emptively for a team that currently understands why the boundary exists. If this ever stops being true (the team grows, violations start slipping through review), that's the trigger to add automated enforcement (e.g. an ESLint import-boundary rule) — noted here so it's a recognized escalation path, not a surprise.

## 6. Every deferral is documented, not silent

The theme running through this whole document: this project defers a lot of things (domain events, granular permissions, Redis, a frontend framework, API versioning, general optimistic locking). None of those deferrals are silent — each one has an ADR or a documented trigger condition explaining *why not now* and *what would change the answer*. A future engineer encountering a limitation should be able to find out whether it was an oversight or a decision, and if a decision, what would justify revisiting it. That's the actual point of all this documentation: not to justify complexity, but to make simplicity legible as a choice rather than a gap.

## 7. When in doubt, match the existing codebase's comfort level

Where a source project already had a working, reasonable pattern (Pricing Portal's raw-SQL comfort with `better-sqlite3`, its granular per-resource REST endpoints, its `db.transaction()` discipline for multi-table writes), this project carries that pattern forward rather than replacing it with something "more sophisticated" for its own sake — e.g. Knex over a full ORM, because raw-SQL-adjacent query building is what this team is already fluent in, and a full ORM's abstraction isn't earning its cost here (§2).
