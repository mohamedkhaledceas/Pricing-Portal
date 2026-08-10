# ADR-0005: Role-Based Access with Permission-String Indirection

## Status
Accepted

## Problem
The merged system needs authorization spanning two (soon more) modules, for users who may have access to one, both, or neither, with different capabilities within each (an employee submits their own requests; a manager approves their team's; P&C acts on anyone; a Pricing user never sees HR data at all). The naive approaches are either too rigid (a single global role that can't express "Pricing-only" vs "Employees-only" access) or too complex for what's actually needed (a fully granular, per-user, database-backed permission system with no current requirement driving it).

## Decision
Two-part model:
1. **Binary module access** via a `user_module_access` join table (`user_id`, `module_code`) — orthogonal to role, since access to a module and capability within it are independent questions.
2. **A single flat role enum** (`admin`, `pricing_user`, `hr_admin`, `manager`, `employee`) determines capability within whichever module a user has access to.
3. **Authorization checks reference permission strings** (`leave:approve:team`, `employee:revoke:any`, ...), resolved through a static `ROLE_PERMISSIONS` map in `common/constants/permissions.js` — not raw role-name arrays scattered across route definitions.

## Alternatives considered
- **Per-module role fields** (`pricing_role`, `employees_role` as independent enums) — considered in Phase 1, not chosen. More flexible in theory (a user could be "owner" in Pricing and "employee" in Employees simultaneously with fully independent semantics), but the client explicitly preferred the simpler single flat role list, and no concrete requirement demanded the extra flexibility.
- **Full granular permission system now** (per-user or per-role toggles for every individual action, database-backed, with an admin UI to manage them) — rejected as over-engineering for 5 roles across 2-3 modules with no current requirement for permission combinations that role membership can't already express. This is the option the Principal Engineer review specifically evaluated and declined to build prematurely.
- **Raw role-name checks at each route** (`authorize(['manager', 'hr_admin'])` inline per route) — this was the Phase 2 draft's original approach; superseded during the hardening review by permission-string indirection, because it scatters the *meaning* of "who can approve leave" across every route definition that needs to know it, making a future change (e.g. adding a new role that should also approve) a multi-file grep-and-edit rather than a one-line change to `ROLE_PERMISSIONS`.

## Trade-offs
- Permission strings add one small layer of indirection (a route says `authorize('leave:approve:team')`, and a developer has to look at `permissions.js` to see which roles that resolves to) — a minor readability cost, accepted because it's what makes the future-proofing (below) essentially free.
- The role enum is still fundamentally coarse — it cannot express "this one employee should also see KPI reports" without either adding a new role or (eventually) evolving `ROLE_PERMISSIONS`'s resolution mechanism to something per-user. This is a known, accepted limit of the current design, not an oversight.

## Consequences
- If real per-user permission overrides are ever needed, only how `ROLE_PERMISSIONS` is *resolved* changes (static in-memory map → database-backed lookup, e.g. a `role_permissions` or `user_permission_overrides` table) — every call site across the codebase (`authorize('leave:approve:team')`) stays exactly as written. This is the specific, cheap future-proofing move this ADR makes: change the representation now, defer the expensive part (a real permission-management system) until it's actually needed.
- Manager scope for **revoke** is unscoped (any employee, per explicit client decision) while **approve/reject** defaults to scoped (direct reports only, since it's a routing concept tied to `manager_id`) — an intentional asymmetry, flagged for final confirmation in `docs/architecture.md` §5.4 before implementation, not a silent inconsistency.
