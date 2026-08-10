# ADR-0003: PostgreSQL over SQLite, Knex over a Full ORM

## Status
Accepted

## Problem
Pricing Portal runs on SQLite via `better-sqlite3` — fine for a small team's low-write-volume tool, but SQLite locks the entire database file per write, and the client expects meaningful user growth once Employees Portal (with its own write traffic — leave request submissions, approvals) merges in on top of Pricing's existing write load. Additionally, the existing schema is defined as inline `CREATE TABLE IF NOT EXISTS` statements with no version history, which doesn't scale as the schema grows to cover HR data.

## Decision
Move to **PostgreSQL**, one shared instance/database with per-module tables (not per-module databases — see `docs/architecture.md` §2 for the module-boundary reasoning). Use **Knex.js** as the query builder and migration runner, not a full ORM (Prisma, Sequelize, TypeORM) and not raw `pg` with a separately-chosen migration tool.

## Alternatives considered
- **Stay on SQLite** — rejected given the client's explicit expectation of meaningful growth and the concurrent-write pattern that adds (leave request submissions and approvals happening independently of, and concurrently with, Pricing usage). Would have deferred a disruptive migration to a later, less convenient time rather than doing it once now while the schema is already being redesigned.
- **Full ORM (Prisma/Sequelize)** — rejected. The existing codebase's comfort level is hand-written SQL via `better-sqlite3`; an ORM's model-class abstraction and generated-query behavior is a real learning curve and a layer of magic that isn't earning its cost against a schema of this size and complexity. Knex gives parameterized query building (the actual safety/readability win) and a migration runner (the actual versioning win) without introducing model classes, a schema DSL, or ORM-specific query behavior to learn and debug.
- **Raw `pg` + a separate migration library** (e.g. `node-pg-migrate`) — rejected in favor of Knex specifically because it's one dependency covering both needs (query building and migrations) instead of two, with less integration surface between them.
- **Separate database per module** — rejected; see ADR-0001 and `docs/architecture.md` §2 (one shared database matches the "operational consolidation only" scope decision; separate databases would double backup/migration/monitoring overhead for a single-company internal tool with no requirement for physical data isolation between its own two domains).

## Trade-offs
- Postgres requires a managed instance (more infrastructure than a SQLite file) — accepted as necessary given the growth expectation; the client's existing hosting reference (Render) offers this directly, so it isn't a new operational relationship, just a new resource.
- Knex's query builder is less type-safe and less "magic" than an ORM — intentional; see `docs/engineering-principles.md` §3 on preferring explicit over clever.

## Consequences
- Every schema change is a versioned Knex migration file (`db/migrations/`), tracked in a `knex_migrations` table — no more inline `CREATE TABLE IF NOT EXISTS`.
- CHECK constraints on text columns are used instead of native Postgres `enum` types for role/status fields, specifically because enum-type migrations are more disruptive than CHECK-constraint migrations, and this schema's enum-like fields (role, in particular) have already been revised multiple times during design — see `docs/database.md` §3.
