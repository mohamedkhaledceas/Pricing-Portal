# ADR-0010: Cohort-Based Quarterly KPI Tracking for the Commercial Lead Funnel

## Status
Proposed

## Scope note — this ADR governs the legacy codebase, not the target modular architecture

Every prior ADR in this directory (0001–0009) describes the **target** modular-monolith/Postgres architecture that `docs/migration-plan.md` is staged to build. The Commercial Lead ClickUp dashboard (`server/src/commercialLead.js`, `clickupSync.js`, `clickup.js`, `commercial-lead.html`) does not live there — it was built directly into the **legacy `server/src` SQLite-backed app**, the exact codebase `docs/migration-plan.md` §M8 slates for deletion once the migration completes. That app is also the one currently deployed and serving real Commercial Lead data.

This ADR is scoped narrowly: it governs how quarterly KPI tracking is added **to the existing legacy Commercial Lead feature**, using the same stack it already uses (`better-sqlite3`, `node-cron`, the flat `server/src/*.js` file layout). It does not attempt to reconcile this with ADR-0001's modular-monolith decision, and it does not update `docs/architecture.md` or `docs/database.md`, both of which are explicitly target-state documents with no current section for this feature. If/when the migration plan reaches a milestone that ports Commercial Lead into `modules/`, this ADR's decisions (bucket definitions, cohort semantics, the events-ledger approach) should carry over — only the storage engine and file layout would need to change.

## Problem

The Commercial Lead dashboard currently shows only live, real-time state: current deal counts per status, a cross-list funnel snapshot, and stage-duration averages (`commercial_lead_stage_history`, populated only since ~2026-08-13 when `clickupSync.js`'s stage tracking went live). There is no notion of a business quarter, no way to compare quarter-over-quarter performance, and no historical record — every number is "right now," and there's no way to ask "how did Q2 actually perform" without re-deriving it from raw ClickUp data by hand (as was done ad hoc for this ADR's own discovery work).

The business wants a quarterly KPI row on the dashboard: pitch volume, funnel-stage counts, two conversion rates, a won/lost split, and a repeat-client rate — navigable across quarters, with the current quarter always live and past quarters historically stable. Two requirements are in tension and need an explicit design, not an implicit one:

1. **A quarter, once closed, needs a stable historical record** — "what did we report Q3 as, at the time" shouldn't silently change months later.
2. **The same cohort of deals keeps moving after its quarter closes** — a deal created in Q3 can still convert to In Progress or Won in Q4 or later, and the business wants to know that eventual outcome too, not just what was true the moment Q3 ended.

Conflating these two into one number (as an earlier round of this design did, before this distinction was raised) produces a dashboard that can't answer either question cleanly: freeze it and you lose the "what eventually happened" view; keep it live and "what we reported for Q3" keeps drifting.

## Decision

### Two distinct, named concepts — never conflated

- **Quarter-end snapshot**: what was true *at the instant a quarter closed*, for that quarter's own cohort. Computed once, by a scheduled job, at the moment the quarter boundary is crossed. **Immutable once written.** Answers "what did we report Q3 as, at the time."
- **Cohort performance**: what has *eventually* happened to a quarter's cohort, evaluated using all data known as of right now. **Never frozen, never stored** — always computed live from the permanent event ledger, for any quarter (open or closed). Answers "of the deals Q3 originally produced, where do they actually stand today."

A deal's **cohort** (which quarter it belongs to) is permanently fixed at creation and never changes, regardless of when it later transitions. Both concepts above are evaluated against that same, fixed cohort membership — they differ only in *which point in time* the evaluation is anchored to (quarter-close vs. right now), not in which deals are counted.

### Funnel definition

Source: the **2026 Projects** ClickUp list (`901518274897`) only — the sibling **Active Clients — AM** and **Client Offboarding** lists in the same folder are excluded, per the earlier discovery that neither is funnel-shaped and Active Clients only started being synced this quarter.

| Bucket | ClickUp statuses |
|---|---|
| Leads | `leads` |
| Qualified | `qualified`, `in queue` |
| Onboarding | `onboarding` |
| In Progress | `in progress` |
| Won | `contract completed` |
| Lost | `stuck`, `lost`, `unqualified`, `terminated by agency`, `terminated by client`, `no answer` |

`complete` (distinct from `contract completed`) is **intentionally excluded** from every bucket — its operational meaning relative to `contract completed` hasn't been confirmed with whoever owns the ClickUp list (6 of the current 196 deals carry this status). Excluding it rather than guessing a bucket keeps the funnel honest; revisit once that's clarified.

Two conversion rates, both same-cohort:
- **Conversion 1** = Leads → In Progress (of the cohort, what fraction ever reached In Progress)
- **Conversion 2** = In Progress → Won (of the subset that reached In Progress, what fraction went on to Won)

### Repeat Client Rate — a separate client-level metric, not a funnel stage

A client completing a contract and returning months later, possibly for a different service, is real repeat business — but it isn't another position in the Lead→Won pipeline, and the quarter it belongs to (completion quarter) is a different anchor than the funnel's (creation quarter). It gets its own cohort dimension, and — like the funnel metrics — it is evaluated in the same two modes established above, never conflated:

- **Repeat Client Rate — quarter-end snapshot** (frozen, stored in `commercial_lead_quarter_snapshots`): of clients whose Won event fell in quarter Q, what fraction had *already* returned by the exact instant Q closed.
  > = (clients with a Won event in Q **and** a subsequent Leads event with `entered_at` ≤ Q's close timestamp) ÷ (clients with a Won event in Q)
- **Repeat Client Rate — cohort performance** (live, never stored, recomputed on every read, available for open *and* closed quarters alike): of that same cohort, what fraction have returned *as of right now*.
  > = (clients with a Won event in Q **and** a subsequent Leads event with `entered_at` ≤ now) ÷ (clients with a Won event in Q)

Only the "≤ Q's close" vs. "≤ now" boundary differs — same cohort, same rule, evaluated at two different instants, exactly mirroring how Conversion 1 and Conversion 2 are handled. The snapshot value will typically be at or near zero by construction (a client can't plausibly return within the same quarter their contract just ended) — that's expected, not a defect, and both documents call it out explicitly so it isn't mistaken for a bug later. The live cohort-performance value is where this metric actually becomes informative, as return activity accumulates in later quarters. "Returned" counts regardless of whether the new engagement is the same service or a different one, per explicit confirmation — this is a business-relationship metric, not a service-repurchase metric.

**Identity matching (explicit rule, revised during Step 3 implementation)**: two deals belong to the same client if, after normalizing both deals' `Email` field values (trim whitespace, lowercase), the values are equal — **or**, independently, after the same normalization, both deals' `Client Name ` field values are equal (trailing space is real, matches ClickUp's actual field name). A match on either field alone is sufficient; both are checked whenever populated.

The original decision named `Company` as the second field, on the reasonable-looking assumption that it held the client's business name. Verified against real data while implementing the backfill, it does not: `Company`'s dominant values (`Ceas Comm` on 102 of 152 populated deals, plus close variants `Ceas Comm FZE` and `Ceas Figures`) are CEAS's own internal business lines, not client identities — using it collapsed roughly 100 unrelated deals into one false "client," producing a nonsensical 100% repeat-client rate on the very first backfilled quarter. `Client Name ` was checked as the alternative and its values (`Twasool`, `Jamjoom Pharma`, `SALAM PROPERTIES`, etc., each appearing once or twice) look like genuine, distinct client businesses. Trade-off: lower coverage (50/196 have `Client Name ` populated vs. 152/196 for `Company`) in exchange for not matching on a field that was actively wrong. Combined with `Email` (142/196 populated), 25 deals have neither usable field (verified by direct count, not estimated). Deals with neither field populated are **excluded from repeat-client matching entirely, on both sides of any comparison** — not guessed at via name similarity or any other heuristic — since a wrong match (merging two unrelated clients, or splitting one client into two) actively corrupts the metric rather than just being incomplete.

### Storage shape

- **`commercial_lead_bucket_events`** — append-only ledger, the single source of truth for both concepts above, for every metric including Repeat Client Rate. One row per time a deal crosses *into* a bucket (lateral moves within a bucket, e.g. `qualified` → `in queue`, do not create a new row). Columns: `deal_id`, `list_id`, `bucket`, `entered_at`, a **generated** `event_quarter` column derived from `entered_at`, `is_backfilled`.
- **`commercial_lead_quarter_snapshots`** — one immutable row per `(list_id, quarter)`, written once by the freeze job, and **holding exclusively quarter-end-snapshot values — never a live/current figure of any kind, for any metric.** Holds the frozen bucket counts, both conversion rates, and the Repeat Client Rate, all *as they stood at that quarter's close*, plus `is_estimated` for pre-tracking quarters.
- **`commercial_lead_live_cache`** (existing table) gains one **generated** column, `origin_quarter`, derived from its existing `clickup_created_at` — the single fact a deal's cohort membership is ever computed from.

No table stores `origin_quarter` on the events ledger. And **no table stores "cohort performance" for anything — funnel or repeat-client alike.** Whenever the dashboard needs a live, as-of-now number for any quarter (open *or* closed) — including the current Repeat Client Rate for a quarter that already closed — it queries `commercial_lead_bucket_events` directly. It never reads a "current" value out of `commercial_lead_quarter_snapshots`; that table is exclusively frozen, quarter-close data. There is exactly one frozen table in this design, and it is exclusively quarter-end data — see the next section for why the events ledger, not a second stored table, is what backs every live figure.

### Why `origin_quarter` isn't duplicated onto the events ledger

An earlier round of this design proposed copying a deal's origin quarter onto every one of its event rows, for query convenience. That's exactly the kind of duplication that produces silent drift (a deal's origin quarter and one of its events disagreeing, with no mechanism preventing it). Instead: `origin_quarter` lives in exactly one place (a **generated column** on `commercial_lead_live_cache`, computed from `clickup_created_at`, which already exists and is never independently written), and `event_quarter` lives in exactly one place (a **generated column** on `commercial_lead_bucket_events`, computed from that row's own `entered_at`). Neither is ever set by application code, so neither can drift from the fact it's derived from. Anything needing both values together joins the two tables on `deal_id` at query time.

### Quarter-boundary timezone — resolved

Repository search found no existing timezone configuration anywhere (no `TZ` env var, no business-hours setting in `company_settings`; `docs/database.md`'s `location` column is an employee office field, unrelated). **Decision: quarter boundaries are evaluated in Africa/Cairo local time**, per the business's actual location — documented here explicitly rather than silently defaulting to UTC.

Egypt's DST rule was verified (not assumed) before deciding how to compute this: under Law No. 24 of 2023, Egypt observes DST (UTC+3) from the last Friday of April through the last Thursday of October, standard time (UTC+2) otherwise — confirmed current for 2026 specifically (DST starts April 24, 2026, ends October 29, 2026). Because that transition always falls in the interior of Q2 and Q4, never near a quarter boundary, a coarse fixed-offset approximation (UTC month May–October → +3h, November–April → +2h) classifies every quarter boundary correctly without needing a full weekday-rule calculation or an IANA timezone database (which SQLite doesn't have). This was verified empirically — not just argued — against both the `sqlite3` CLI and the app's actual `better-sqlite3` driver, across all four quarter boundaries and both 2026 transition dates. Full derivation and the exact SQL: `docs/commercial-lead-quarterly-kpis-plan.md` §5.

## Alternatives considered

- **Period/activity-based primary tile counts** (an earlier round of this design): count bucket-entry events by the quarter *the event itself* happened in, with each deal's origin quarter carried as enrichment metadata on the row. Superseded once the quarter-end-snapshot/cohort-performance distinction was raised — the business's own example ("20 leads in the Q3 cohort... 5 had reached In Progress") frames every number as a property of the *creation*-quarter cohort evaluated at a point in time, not as same-quarter activity counts. The events ledger still supports deriving period-style numbers later if a real need for them shows up; nothing here forecloses that.
- **One frozen table for both concepts** — rejected per the Problem section: it can't represent "what we reported at the time" and "what eventually happened" simultaneously without one of them silently overwriting the other.
- **Materializing/caching cohort performance** for closed quarters instead of computing it live on every read — rejected for now. At current and foreseeable data volume (hundreds of deals per quarter), a live aggregate query over an indexed events table is cheap; a cache would need its own invalidation story for a problem that doesn't exist yet. If read latency ever becomes real, this can be revisited without changing the underlying model — the ledger stays authoritative either way.
- **Guessing client identity via fuzzy name matching** for the 25 deals with no Email/Client Name — rejected; a wrong repeat-client match corrupts the metric in a way that's worse than an honest gap, and there's no reliable signal to guess from.

## Trade-offs

- Pre-2026-08-13 quarters can only ever be **cohort-approximated** (creation date + current status), never true point-in-time-accurate, because no dated transition events exist before `clickupSync.js`'s stage tracking went live. Every backfilled quarter's snapshot carries `is_estimated = true` for this reason, and the UI must surface that badge rather than presenting an estimate as fact.
- The freeze job is a new operational dependency (a `node-cron` schedule that must actually fire correctly at each quarter boundary). Mitigated, not eliminated: a startup catch-up call means a missed fire (server down exactly at the boundary) self-heals on the next boot rather than needing someone to notice and re-run it — but there's still no automatic retry/alerting if the server happens to stay down across an entire quarter boundary *and* the next several restarts. See the implementation plan, Step 5.
- Repeat Client Rate's identity matching (Email OR normalized Client Name) will occasionally misclassify: two genuinely different clients sharing a generic contact email, or the same client under two meaningfully different name spellings that don't normalize to match. This is accepted as the practical ceiling given the source data's actual quality, not treated as solvable within this feature.
- This entire subsystem is built into a codebase (`server/src`) that the project's own migration plan intends to eventually delete. Real, recorded business KPI history would need a deliberate carry-forward step if/when that migration reaches this feature — not automatic.

## Consequences

- The dashboard can honestly show, side by side for any closed quarter, both "what we reported when Q3 closed" and "what that same cohort has gone on to do since" — without either number overwriting the other.
- `commercial_lead_bucket_events` becomes the durable source of truth this feature was missing; any future reporting need (a different quarter definition, a different bucket grouping, a cohort-by-source-channel cut) can be built by querying it differently, without a schema change or a re-backfill.
- The `origin_quarter`/`event_quarter` generated-column approach means cohort and event-time facts can never silently disagree — eliminating a whole class of data-integrity bugs the earlier duplicated-column design would have been exposed to.
- If `complete`'s meaning is clarified later, extending the funnel to include it is additive (a new bucket + rebuilding historical events for it), not a redesign of anything decided here.
