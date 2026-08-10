# API Guidelines

Conventions for every endpoint in the CEAS Portal, across all three modules. The goal is that a developer who has only ever touched `pricing` routes can predict how an `employees` route behaves without reading its code first.

---

## 1. Base paths

```
/api/auth/*
/api/pricing/*
/api/employees/*
/health
/ready
```

Static frontends: `/pricing`, `/employees` (no `/api` prefix — these serve HTML, not JSON).

---

## 2. Versioning — deliberately not introduced

**No `/api/v1/...` prefix.** Versioning exists to let clients and servers evolve independently — it's the right answer when a server has consumers it doesn't control (a public API, third-party integrators, mobile apps on old builds still in the wild). None of that applies here: this is a single Express deployable serving its own frontend, both deployed together, atomically, every time. If an endpoint's shape needs to change, the frontend calling it changes in the same deploy. Introducing versioning now would be solving a problem this project doesn't have, at the cost of real ongoing overhead (maintaining parallel route trees, deciding deprecation policy for versions nobody uses). Revisit only if an external consumer this team doesn't control appears — not before.

---

## 3. Resource naming

- Plural nouns for collections: `/leave-requests`, not `/leaveRequest` or `/leave-request`.
- kebab-case URL segments: `/leave-requests`, `/admin-only` (matches the one existing precedent in today's Pricing API).
- Nested resources reflect real ownership: `/employees/roster/:id/manager` (manager is a property of a roster entry, not a top-level collection).
- Actions that don't map cleanly to CRUD get an explicit verb sub-path, not a repurposed HTTP method: `PUT /leave-requests/:id/approve`, not `PATCH /leave-requests/:id` with a magic `{status: 'approved'}` body that hides the business meaning (and bypasses the state-guard pattern in `docs/database.md` §Optimistic Locking, which needs to know *which* transition is being requested).

---

## 4. HTTP methods

- `GET` — read, no side effects, safe to retry/cache.
- `POST` — create, or an action verb sub-path (`/approve`, `/reject`, `/revoke`).
- `PUT` — full replace of a resource's mutable fields.
- `DELETE` — reserved for genuinely deletable resources (there are almost none in this system, given the revoke-not-delete policy for anything with history — see `docs/database.md`). Where "delete" in the UI actually means "revoke," the endpoint says so: `PUT /employees/users/:id/revoke`, not `DELETE /employees/users/:id`. Naming it accurately prevents a future engineer from "simplifying" it into an actual `DELETE` handler that hard-deletes.

---

## 5. Response envelope

**Success:**
```json
{ "data": { ... } }
```
or, for collections that will eventually paginate:
```json
{ "data": [ ... ], "meta": { "total": 42 } }
```

**Error:**
```json
{ "error": { "message": "Human-readable description", "code": "VALIDATION_ERROR", "details": [ { "field": "startDate", "issue": "required" } ] } }
```

`code` is a stable, machine-readable identifier (`VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `UNAUTHENTICATED`) that frontend code branches on. `message` is for humans and can change for copy/UX reasons without breaking any client logic that depends on `code`. `details` is present only for validation errors (field-level breakdown) and omitted otherwise.

**Why standardize now:** today's Pricing API returns a different shape per endpoint (`{ team: [...] }`, `{ project: {...} }`, `{ settings: {...} }`). This made sense as the API grew organically but isn't a convention a new endpoint can follow by inspection. Since every Pricing endpoint is being re-implemented into the new layered structure as part of this migration anyway, adopting the envelope costs nothing extra — it's not a second migration, it's how the existing one is done.

---

## 6. Pagination, filtering, sorting — conventions defined, not all built yet

**Not implemented for most endpoints at this stage** — current data volumes (single company, dozens of employees, a modest number of pricing projects) don't justify it, and building it everywhere now would be speculative. The response envelope (`meta`) reserves the space so adding it later isn't a breaking change.

**Convention, for when it is needed:**
```
GET /employees/leave-requests?status=pending&sort=-createdAt&page=1&pageSize=25
```
- `sort=field` ascending, `sort=-field` descending.
- Filters are plain query params matching a field name; no query language beyond exact-match/range for now.
- `page`/`pageSize` with `meta.total` in the response once implemented.

**Where this is worth building on day one rather than deferring:** the manager/HR approval queue (`GET /employees/leave-requests?status=pending`) is a real, immediate need — filtering by status there isn't speculative, it's how the approve/reject workflow actually works. Build filtering per-endpoint as each route is implemented, following this convention, rather than deciding the full scope here.

---

## 7. Error responses — consistency rule

Every error response, from every module, goes through the same centralized `errorHandler` (`common/error/errorHandler.js`) and produces the exact envelope in §5. No route handler constructs its own ad-hoc error JSON. If a new kind of error condition appears, it gets a new `AppError` factory in that module's `errors.js` — never an inline `res.status(400).json({...})` in a controller.

---

## 8. Idempotency for state-transition actions

Actions like `/approve`, `/reject`, `/revoke` are guarded by the status-check pattern in `docs/database.md` §Optimistic Locking — calling `/approve` twice on an already-approved request returns `409 CONFLICT` with a clear message, not a silent no-op and not a duplicate side effect (e.g. a duplicate audit log entry or duplicate deduction).

---

## 9. What every new endpoint should be able to answer

Before adding a route, it should be clear:
1. Which module owns it (path prefix makes this obvious).
2. Which permission string gates it (`docs/architecture.md` §5.2).
3. What validator schema shapes its input (`docs/architecture.md` §12).
4. Whether it's a single-table or multi-table write (and therefore needs a transaction — `docs/database.md`).
5. Whether it's a significant-enough action to need an audit log entry (`docs/architecture.md` §8).

If the answer to any of these is unclear, that's a sign the endpoint needs more design thought before being written, not a gap to paper over in the controller.
