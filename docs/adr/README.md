# Architecture Decision Records

Each ADR captures one significant decision: the problem, the decision, alternatives considered, trade-offs, and consequences. ADRs are not updated after acceptance — if a decision changes, a new ADR supersedes the old one (and says so explicitly), so the history of *why* something changed stays readable. `docs/architecture.md` reflects current state; these explain how it got there.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular Monolith over Microservices or Full Rewrite | Accepted |
| [0002](0002-authentication-architecture.md) | Dual-Method Roster-Gated Auth with Split Token Storage | Accepted |
| [0003](0003-postgresql-database.md) | PostgreSQL over SQLite, Knex over a Full ORM | Accepted |
| [0004](0004-clickup-integration-strategy.md) | Own Database as Source of Truth, ClickUp Server-Side Only | Accepted |
| [0005](0005-authorization-model.md) | Role-Based Access with Permission-String Indirection | Accepted |
| [0006](0006-manual-dependency-injection.md) | Manual Factory-Function DI, No Container Framework | Accepted |
| [0007](0007-audit-logging-subsystem.md) | Dedicated Audit Log, Separate from Operational Logging | Accepted |
| [0008](0008-defer-domain-events.md) | Defer a Domain Event System | Accepted |
| [0009](0009-response-envelope-no-versioning.md) | Standard Response Envelope, No API Versioning | Accepted |
| [0010](0010-commercial-lead-quarterly-kpis.md) | Cohort-Based Quarterly KPI Tracking for the Commercial Lead Funnel | Proposed |
