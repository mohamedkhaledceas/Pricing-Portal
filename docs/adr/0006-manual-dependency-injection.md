# ADR-0006: Manual Factory-Function DI, No Container Framework

## Status
Accepted

## Problem
Services need repositories (and, increasingly, cross-cutting things like the audit service and logger) to do their work. The straightforward Node.js default — each service file `require()`s its repository directly at the top of the module — works, but has two real downsides at this project's scale: a service's dependencies are implicit (hidden inside the file, not visible from its "signature"), and swapping or mocking a dependency for a test requires `jest.mock('../repositories/x.repository')` path-interception rather than simply passing a different object in.

## Decision
**Manual dependency injection via factory functions, with one small composition root (`container.js`) per module** — no DI framework/library.

```js
// services/leaveRequest.service.js
module.exports = function createLeaveRequestService({ leaveRequestRepository, auditService, logger }) {
  return { async submitRequest(...) { ... } };
};

// modules/employees/container.js — the composition root for this module
const leaveRequestRepository = require('./repositories/leaveRequest.repository')(db);
const leaveRequestService = require('./services/leaveRequest.service')({ leaveRequestRepository, auditService, logger });
const leaveRequestController = require('./controllers/leaveRequest.controller')({ leaveRequestService });
module.exports = { leaveRequestController };
```

`routes.js` imports only from its module's `container.js` and never constructs a dependency itself.

## Alternatives considered
- **A DI container library** (InversifyJS, tsyringe, Awilix) — rejected. These typically require decorators, reflection metadata, or a registration DSL to learn, none of which this team currently uses anywhere else in the stack (a plain CommonJS/Express codebase). The problem being solved (explicit dependencies, easy test substitution) doesn't require automatic/reflective wiring — it requires *some* place dependencies are assembled explicitly, which a plain object literal already provides.
- **Status quo: direct `require()` of repositories inside services** — rejected as the long-term pattern specifically because it was the thing being asked to reconsider; while it works, it hides dependencies and makes tests lean on `jest.mock` module interception rather than simple constructor-style substitution. See `docs/testing.md` §1 for how this pays off directly in test code.
- **A single global composition root for the whole app** (one file wiring all three modules) — rejected in favor of one `container.js` per module, to keep each module's internal wiring independently readable and to avoid a single file that grows unboundedly as modules are added, which would itself violate the module-boundary spirit (`docs/architecture.md` §2) by being the one place that has to know about everything.

## Trade-offs
- Every file becomes a factory function (`module.exports = (deps) => ({...})`) rather than plain `exports.foo = ...` — a small amount of added ceremony compared to the reference project's style, justified specifically because it's what the composition-root pattern requires, not adopted for its own sake.
- Wiring mistakes (a missing dependency in a `container.js`) surface at app startup (a `container.js` throwing because a required factory arg is undefined) rather than at the specific call site — an acceptable trade since it still fails fast, just at boot rather than at first use.

## Consequences
- Unit tests construct services directly with plain mock objects, no module-path mocking — see `docs/testing.md` §1 for the resulting test shape.
- Adding a new module means adding a new `container.js` following the same shape — no framework configuration, no registration step beyond what's already visible in that file.
