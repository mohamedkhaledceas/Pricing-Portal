# ADR-0009: Standard Response Envelope, No API Versioning

## Status
Accepted

## Problem
Today's Pricing Portal API returns a different JSON shape per endpoint (`{ team: [...] }`, `{ project: {...} }`, `{ settings: {...} }`) with no consistent error shape beyond a bare `{ error: string }`. As the API grows to cover two more modules, this inconsistency would only compound, and each new endpoint would have no clear precedent to follow. Separately: should the API be versioned (`/api/v1/...`) given it's about to grow substantially?

## Decision
- **Standard response envelope** for all three modules: success as `{ data }` (optionally `{ data, meta }` for future pagination), error as `{ error: { message, code, details? } }` with a stable machine-readable `code` distinct from the human-readable `message`.
- **No API versioning.** Single Express deployable, frontend and backend always deployed together, no third-party or independently-released API consumers.

## Alternatives considered
- **Leave each endpoint's shape as-is / decide per-endpoint** — rejected. Since every Pricing endpoint is already being re-implemented into the new layered structure as part of this migration, standardizing costs nothing extra (it's not a second migration) and removes an entire category of "what shape does this endpoint return" guessing for new work.
- **Version the API now** (`/api/v1/...`) in anticipation of future needs — rejected. Versioning solves the problem of a server needing to support multiple client expectations simultaneously (a public API with external integrators, a mobile app with old builds still in the field). This project has neither: the frontend is deployed atomically with the backend every time, so there is never a moment where an old client needs to keep working against a new server. Introducing versioning would mean maintaining the appearance of independent evolution that doesn't actually happen here, at real ongoing cost (parallel route trees, a deprecation policy for versions with no real independent consumers).
- **A `code` field derived from HTTP status alone (no separate string)** — rejected; HTTP status codes are coarser than the distinctions frontend code needs to make (e.g. two different `400`s meaning different things), and coupling UI logic to exact `message` text is brittle against copy changes.

## Trade-offs
- The envelope adds one layer of nesting (`response.data.team` instead of `response.team`) to every API call — a one-time frontend adjustment during migration, not an ongoing cost.
- Not versioning means any genuinely breaking API change requires the frontend to change in the same deploy — already true today given the single-deployable architecture (ADR-0001), so this isn't a new constraint, just an explicit acknowledgment of an existing one.

## Consequences
- New endpoints in any module follow the envelope by default — deviating from it is something to justify in review, not a per-endpoint choice.
- If an external consumer this team doesn't control ever needs to call this API independently of the frontend (the condition that would justify versioning), that's the trigger to revisit — not before.
