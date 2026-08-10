# ADR-0007: Dedicated Audit Log, Separate from Operational Logging

## Status
Accepted

## Problem
The architecture already has structured operational logging (`common/logger/`) — stdout, JSON, correlation-ID-tagged, meant for debugging "what is the system doing and why did something break." That's a different job from "who approved this leave request, who changed this salary figure, who revoked this account, and when" — a durable, queryable, per-actor accountability record. Operational logs are typically short-retention and shaped for debugging, not for "show me every action user X took" queries, and this system is about to hold salary data, HR approvals, and account-revocation actions where that distinction matters.

## Decision
Introduce a dedicated **`common/audit/`** subsystem: an `audit_log` table (`actor_user_id`, `action`, `target_type`, `target_id`, `metadata`, `correlation_id`, `created_at`), a repository, and a thin `auditService.record(...)` called **explicitly, inline** from services at the points that matter — role/permission changes, salary edits, leave approvals/rejections, revocations, manager reassignment. A minimal admin-only read endpoint (`GET /api/audit-log`) exposes it for review. Entries are treated as append-only — never updated or deleted at the application layer.

Lives in `common/`, not inside any single module, since `pricing`, `employees`, and `auth` all need to write to it — placing it inside one module would violate the no-cross-module-import rule (`docs/architecture.md` §2) the moment another module needed it.

## Alternatives considered
- **No distinction — rely on operational logs for everything** — rejected. Operational logs answer "what happened" for debugging; they're not designed to be queried "show me everything user X did" reliably over time, and typically don't carry the same retention/immutability expectations an audit trail needs.
- **Emit via a domain-event system, with audit logging as a subscriber** — considered and rejected for now; see ADR-0008. With exactly one current consumer (audit logging itself), an event system adds indirection without a second consumer to justify decoupling from.
- **Audit logging as its own full module** (with its own routes/controllers/services/repositories directory structure like `pricing`/`employees`) — rejected as more structure than the actual complexity here warrants; it's a repository, a thin recording service, and one read endpoint, not a domain with its own business logic worth a full module skeleton.

## Trade-offs
- Every service that performs a significant action must remember to call `auditService.record(...)` explicitly — there's no automatic interception guaranteeing this happens. Mitigated by making it part of the definition of "done" for a piece of code (`docs/coding-standards.md` §9) and called out specifically in code review, not enforced mechanically.
- Retention policy (how long entries are kept) is a compliance/legal question this ADR doesn't answer — explicitly left as an open policy question, not assumed, since it's not an architecture decision this project is positioned to make unilaterally.

## Consequences
- If a second independent consumer of "significant action happened" ever appears (e.g. notifications, per the backlog in `docs/architecture.md` §21), migrating these explicit calls into emitted events is a small, mechanical refactor (wrap the direct call, add a listener) — not a rewrite, because the call sites and the information being recorded don't change, only how they're dispatched. See ADR-0008.
