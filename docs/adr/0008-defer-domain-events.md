# ADR-0008: Defer a Domain Event System

## Status
Accepted (deferred, with explicit revisit trigger)

## Problem
The Principal Engineer review asked whether the architecture should include a lightweight event-driven mechanism for domain events (`EmployeeRevoked`, `LeaveApproved`, `QuoteGenerated`, `UserCreated`), given that several plausible future consumers exist (audit logging, notifications).

## Decision
**Defer.** Audit logging (ADR-0007) — the one consumer that's an actual, current requirement — calls `auditService.record(...)` explicitly and inline from services, not via an emitted event. No event emitter/pub-sub mechanism is introduced at this time.

## Alternatives considered
- **Introduce an in-process `EventEmitter`-based system now**, with audit logging as its first subscriber — rejected. An event system earns its value when *multiple independent consumers* react to the same state change without needing to know about each other. With exactly one real consumer today, an event system adds a layer of indirection (tracing "what happens when leave is approved" means finding a listener registration somewhere, instead of reading the service method top-to-bottom) without buying the decoupling benefit it exists for.
- **Introduce it preemptively because notifications are on the backlog** — rejected. The onboarding/offboarding notification requirement (`docs/architecture.md` §21) has no defined channel (email/in-app/Slack — explicitly undecided in Phase 1) and isn't scoped for the initial migration. Building event infrastructure for a consumer that doesn't have a defined shape yet is speculative.

## Trade-offs
- If a second consumer appears later, some rework is needed: the direct `auditService.record(...)` calls (and any other significant-action call sites) become `events.emit('leave.approved', {...})` calls, with listeners registered for each consumer. This is a small, mechanical change — not a rewrite — because the call sites and the data already exist; only the dispatch mechanism changes.
- Choosing not to build this now means "what reacts to a leave approval" is currently answerable by reading one service method, which is itself a readability benefit for as long as the single-consumer situation holds.

## Consequences — explicit revisit trigger
Reconsider this ADR when **a second, genuinely independent consumer** of the same state-change needs to react to it without being directly coupled to the original service call (e.g., notifications gets a defined channel and needs to fire off "leave approved" independent of audit logging). Until then, direct calls are simpler, more traceable, and cost nothing extra to migrate away from later.
