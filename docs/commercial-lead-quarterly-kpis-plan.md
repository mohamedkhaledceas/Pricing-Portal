# Commercial Lead: Quarterly KPI Tracking — Implementation Plan

Companion to `docs/adr/0010-commercial-lead-quarterly-kpis.md`, which explains the *why*. This document is the *how*: exact schema, exact calculation logic, and the sequenced steps to build it. Per this repo's own process, **this is a documentation-phase deliverable — implementation does not begin until this plan is explicitly approved.**

Applies entirely within the existing legacy `server/src` codebase (SQLite via `better-sqlite3`, `node-cron` for scheduling) — see the ADR's scope note for why this isn't built against `docs/database.md`'s target Postgres schema.

---

## Ground rules

- The **2026 Projects** ClickUp list (`901518274897`) is the only data source. Active Clients — AM and Client Offboarding are out of scope for this feature.
- Every bucket-classification decision lives in **exactly one place** — a single `mapStatusToBucket(status)` function — referenced by the live sync hook, the backfill script, the freeze job, and every read query. No second implementation of the status→bucket table is ever written inline anywhere else.
- `commercial_lead_bucket_events` is the only source of historical/derived truth. `commercial_lead_quarter_snapshots` is a frozen, read-only cache of what that ledger said at one specific instant (quarter close) — it is never queried for a "current" figure, for any metric, for any quarter, open or closed.

---

## 1. Bucket mapping (single source: `server/src/commercialLeadBuckets.js`, new file)

| Bucket | ClickUp statuses |
|---|---|
| `leads` | `leads` |
| `qualified` | `qualified`, `in queue` |
| `onboarding` | `onboarding` |
| `in_progress` | `in progress` |
| `won` | `contract completed` |
| `lost` | `stuck`, `lost`, `unqualified`, `terminated by agency`, `terminated by client`, `no answer` |
| *(unmapped — excluded)* | `complete` |

```js
// server/src/commercialLeadBuckets.js
const STATUS_TO_BUCKET = {
  'leads': 'leads',
  'qualified': 'qualified',
  // Trailing space is real, not a typo — ClickUp's actual status value is
  // "in queue " (verified directly against live deal data and
  // commercial_lead_status_colors, not assumed from the clean name).
  // Without the exact match every "in queue " deal maps to no bucket at
  // all and silently drops out of the funnel — caught during Step 3
  // implementation when the backfill script reported 10 unmapped deals
  // instead of the expected 6 (only `complete` should be unmapped).
  'in queue ': 'qualified',
  'onboarding': 'onboarding',
  'in progress': 'in_progress',
  'contract completed': 'won',
  'stuck': 'lost',
  'lost': 'lost',
  'unqulified': 'lost',       // matches ClickUp's actual (misspelled) status value
  'terminated by agency': 'lost',
  'terminated by client': 'lost',
  'no answer': 'lost',
  // 'complete' intentionally absent — excluded pending clarification, see ADR-0010
};

function mapStatusToBucket(status) {
  return STATUS_TO_BUCKET[status] || null;
}
```

---

## 2. Schema

### New table: `commercial_lead_bucket_events`

```sql
CREATE TABLE commercial_lead_bucket_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id       TEXT NOT NULL,
  list_id       TEXT NOT NULL,
  bucket        TEXT NOT NULL CHECK (bucket IN ('leads','qualified','onboarding','in_progress','won','lost')),
  entered_at    TEXT NOT NULL,                      -- ISO 8601 UTC, the real ClickUp-sourced transition time
  event_quarter TEXT GENERATED ALWAYS AS (<the §5 quarter expression, applied to entered_at>) STORED,
  is_backfilled INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP  -- ledger-row insert time; debugging only, not business time
);
CREATE INDEX idx_cl_bucket_events_deal ON commercial_lead_bucket_events(deal_id);
CREATE INDEX idx_cl_bucket_events_lookup ON commercial_lead_bucket_events(list_id, bucket, event_quarter);
```

One row per time a deal *crosses into* a bucket — not per raw ClickUp status change. A deal moving `qualified` → `in queue` (same bucket) writes nothing; `qualified` → `onboarding` writes one row. A deal may re-enter a bucket it left before (e.g. `lost` → reopened → `qualified` → `lost` again) — that's two `lost` rows, both real, neither deduplicated away.

### New table: `commercial_lead_quarter_snapshots`

```sql
CREATE TABLE commercial_lead_quarter_snapshots (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id                       TEXT NOT NULL,
  quarter                       TEXT NOT NULL,       -- e.g. '2026-Q3'
  cohort_size                   INTEGER NOT NULL,     -- deals with origin_quarter = quarter
  qualified_count               INTEGER NOT NULL,
  onboarding_count              INTEGER NOT NULL,
  in_progress_count             INTEGER NOT NULL,
  won_count                     INTEGER NOT NULL,
  lost_count                    INTEGER NOT NULL,
  conversion_1_rate             REAL NULL,            -- leads -> in_progress, at close; NULL if cohort_size = 0
  conversion_2_rate             REAL NULL,            -- in_progress -> won, at close; NULL if in_progress_count = 0
  repeat_clients_completed_count INTEGER NOT NULL,    -- matched clients with a Won event in this quarter
  repeat_clients_returned_count  INTEGER NOT NULL,    -- of those, how many had a later Leads event by close
  repeat_client_rate            REAL NULL,            -- NULL if repeat_clients_completed_count = 0
  is_estimated                  INTEGER NOT NULL DEFAULT 0,
  frozen_at                     TEXT NOT NULL,
  UNIQUE(list_id, quarter)
);
```

**This table holds quarter-end-snapshot values only.** No code path ever reads it to answer "what's the current number for quarter Q" — that question, for any quarter, always goes to `commercial_lead_bucket_events` directly (§6). This table exists solely to answer "what did we report at the time."

### Altered table: `commercial_lead_live_cache`

```sql
ALTER TABLE commercial_lead_live_cache
  ADD COLUMN origin_quarter TEXT GENERATED ALWAYS AS (<the §5 quarter expression, applied to clickup_created_at>) VIRTUAL;
```

The single place a deal's cohort membership is ever computed from — derived from the column that already exists, never independently written. **`VIRTUAL`, not `STORED`, and this is required, not a style choice**: `commercial_lead_live_cache` already has 196 rows, and SQLite refuses `ALTER TABLE ADD COLUMN ... STORED` on a non-empty table (verified directly against `better-sqlite3` — it errors with `cannot add a STORED column`; the same statement succeeds on an empty table, since `STORED` needs a value computed and written for every existing row, which `ADD COLUMN` doesn't do). `VIRTUAL` has no such restriction and was verified to work identically, including under an index (`CREATE INDEX ... ON commercial_lead_live_cache(origin_quarter)` succeeds and is used for lookups) — no behavioral difference for this feature's read patterns, just computed at query time instead of at write time. `commercial_lead_bucket_events.event_quarter` (§2 above) stays `STORED` because that table is created fresh via `CREATE TABLE`, not altered — no rows exist yet, so the restriction doesn't apply there.

---

## 3. Event capture (extends `clickupSync.js`) — done

**`entered_at` source resolved by reading the existing code, not by guessing:** `recordStageTransition` already computes `now = new Date().toISOString()` — our own sync-observed timestamp — for both `commercial_lead_stage_history` and `commercial_lead_stage_tracking`, and deliberately does **not** use any ClickUp-provided field for this. That's the right call for `bucket_events` too, for the same reason stated in the existing code's own comment: our own observed time is "the honest measure of what our system observed," and ClickUp's `task.date_updated` fires on *any* edit to a task (a comment, an unrelated custom-field change), not specifically a status change — it would be a worse proxy, not a better one. `bucket_events.entered_at` uses the exact same `now` as the `stage_history`/`stage_tracking` rows written in the same call, so all three stay consistent with each other for any given transition.

**Implemented:** a new `recordBucketEvent(taskId, listId, previousStatus, newStatus, enteredAt)` helper in `clickupSync.js`, called from inside `recordStageTransition` (so it fires from both the webhook path and the reconciliation path, which both funnel through `syncTaskRecord` → `recordStageTransition` already). Maps both the previous and new status through `mapStatusToBucket()`; inserts a row only if the new bucket is non-null **and** differs from the previous bucket — so a lateral move within a bucket, a no-op status "change" (webhook redelivery), and a transition into the unmapped `complete` status all correctly write nothing.

**Completion criteria — verified by direct simulation against a copy of the real schema (not just read through):**
- [x] First-ever sync of a deal into a mapped status (`previousTracking = null`) writes one bucket_events row
- [x] A real bucket crossing (e.g. `qualified` → `onboarding`) writes one row
- [x] A lateral move within the same bucket (`qualified` → `in queue`) writes nothing
- [x] A no-op call (status unchanged) writes nothing and does not crash — confirmed this is still caught by `recordStageTransition`'s existing early-return guard, which now also covers the new bucket logic since it sits after that guard
- [x] A transition into the unmapped `complete` status writes nothing
- [x] A transition *out of* `complete` into a mapped status (previous bucket `null`, new bucket non-null) correctly writes a row
- [x] The sibling `commercial_lead_stage_history` table's existing behavior is unaffected — same rows produced as before this change
- [x] Module still loads cleanly with no leftover test seams

---

## 4. One-time historical backfill

Covers everything that predates this feature: seeds the ledger for all currently-existing deals, **and** seeds `commercial_lead_quarter_snapshots` for every calendar quarter that had already closed before this system existed (everything through the quarter before the current one — currently, Q2 2026 and earlier).

**Ledger backfill:** for each deal in `commercial_lead_live_cache` (list `901518274897`) whose current status maps to a bucket, insert exactly one `commercial_lead_bucket_events` row: `bucket = mapStatusToBucket(current status)`, `entered_at = clickup_created_at`, `is_backfilled = 1`. Deals whose current status is `complete` get no row (excluded). This is the acknowledged approximation described in the ADR — creation date + current status stands in for "when it actually happened," since no dated transition history exists before the sync started recording it.

**Historical snapshot backfill:** for each already-closed quarter, run the same computation the freeze job will run going forward (§5), using `T_close` = that quarter's actual calendar end instant (Cairo local time) and the backfilled ledger rows as input. Every row produced this way gets `is_estimated = 1`.

Script must be **idempotent** — safe to re-run without double-inserting (skip deal IDs that already have a backfilled ledger row; skip `(list_id, quarter)` pairs that already have a snapshot row).

---

## 5. Quarter definition & the `quarter_of()` function — resolved

Calendar quarters (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec), evaluated in **Africa/Cairo local time** (see ADR-0010 — no existing repo/business timezone config was found, so this is a new, explicit decision, not an inherited default).

**Egypt's current DST rule (verified, not assumed):** under Law No. 24 of 2023, Egypt observes DST (UTC+3 / EEST) from the last Friday of April through the last Thursday of October each year; standard time (UTC+2 / EET) applies the rest of the year. Confirmed for 2026 specifically: DST starts midnight Friday, April 24, 2026, and ends Thursday, October 29, 2026, 24:00. ([timeanddate.com](https://www.timeanddate.com/time/change/egypt/cairo), [Wikipedia](https://en.wikipedia.org/wiki/Daylight_saving_time_in_Egypt))

**Why a fixed-offset approximation is safe here** (not a general-purpose tz solution, deliberately): SQLite has no IANA timezone database — its date functions only support fixed numeric UTC offsets, not a named zone with automatic DST rules. Computing the exact weekday-based transition (last Friday of April / last Thursday of October) inside a generated-column expression is possible but unnecessary for this specific use, because **the DST transition always falls in the interior of Q2 (late April) and Q4 (late October) — nowhere near any of the four quarter-boundary dates (Jan 1, Apr 1, Jul 1, Oct 1)**. Concretely: Jan 1 and Apr 1 always fall before the April transition (standard time, UTC+2); Jul 1 and Oct 1 always fall after the April transition and before the October one (DST, UTC+3) — true for any year under this rule, not just 2026. A coarse approximation — **UTC month May–October → apply +3h, UTC month November–April → apply +2h** — therefore classifies every quarter boundary correctly, even though it's technically wrong about the exact offset for the few days each April/October where the approximation and the real transition date disagree (irrelevant, since those days are deep inside Q2/Q4, never near a month that changes which quarter something falls in).

This was verified empirically, not just argued: the exact generated-column expression below was run against both the `sqlite3` CLI (3.51.0) and the app's actual `better-sqlite3` driver (bundled SQLite 3.49.2, well above the 3.31 minimum generated-columns require), across the four boundary crossings and the two real 2026 DST transition dates. All twelve test cases — including the critical Sep 30/Oct 1 boundary, which requires DST-awareness to classify correctly — produced the expected quarter.

```sql
event_quarter TEXT GENERATED ALWAYS AS (
  strftime('%Y', datetime(entered_at,
     (CASE WHEN CAST(strftime('%m', entered_at) AS INTEGER) BETWEEN 5 AND 10 THEN '+3 hours' ELSE '+2 hours' END)
   ))
  || '-Q' ||
  ((CAST(strftime('%m', datetime(entered_at,
     (CASE WHEN CAST(strftime('%m', entered_at) AS INTEGER) BETWEEN 5 AND 10 THEN '+3 hours' ELSE '+2 hours' END)
   )) AS INTEGER) - 1) / 3 + 1)
) STORED
```

The same expression (substituting the relevant date column) is used for `commercial_lead_live_cache.origin_quarter` in §2.

**Residual, explicitly accepted limitation:** if Egypt's DST law changes again (as it has multiple times in the past decade) such that a transition date ever moves to fall *within* a few days of a quarter boundary, this approximation would need revisiting. Not a concern under the current law, and cheap to re-verify (re-run the same test harness) if the law changes — flagged here so it isn't forgotten, not because it's expected.

---

## 6. Live calculation — current quarter & cohort performance (any quarter)

Never stored; always computed from `commercial_lead_bucket_events` joined to `commercial_lead_live_cache` on `deal_id`.

**Funnel cohort** (anchored on `origin_quarter` — the deal's creation quarter):
```
cohort            = deals WHERE list_id = X AND origin_quarter = :quarter
cohort_size       = COUNT(cohort)
<bucket>_count    = COUNT(DISTINCT deal_id) among cohort deals with
                    a bucket_events row WHERE bucket = '<bucket>'   -- no entered_at ceiling = "ever reached, as of now"
conversion_1_rate = in_progress_count / cohort_size            (NULL if cohort_size = 0)
conversion_2_rate = won_count / in_progress_count              (NULL if in_progress_count = 0)
```

**Repeat Client cohort** (anchored differently — on the *Won event's own* `event_quarter`, not the deal's `origin_quarter`; see ADR-0010):
```
won_this_quarter  = bucket_events WHERE list_id = X AND bucket = 'won' AND event_quarter = :quarter
matched_clients   = won_this_quarter deals resolved to a client identity (§7), excluding unmatchable deals
completed_count   = COUNT(DISTINCT matched_clients)
returned_count    = COUNT(DISTINCT clients in matched_clients who also have a 'leads' bucket_events row,
                    for a different deal, with entered_at AFTER their Won entered_at)   -- no ceiling = "as of now"
repeat_client_rate = returned_count / completed_count           (NULL if completed_count = 0)
```

This is the **cohort-performance** read path — used for the open current quarter (which has no snapshot yet) and, on demand, for any closed quarter's "as of today" figure alongside its frozen snapshot.

---

## 7. Client identity matching (Repeat Client Rate only)

Two deals belong to the same client if, after normalizing both deals' `Email` custom-field value (trim, lowercase), the values are equal — **or**, independently, after the same normalization on `Client Name ` (trailing space is real — matches ClickUp's actual field name), those values are equal. Either match alone is sufficient. Deals with neither field populated are excluded from matching entirely (currently 25 of 196) — never guessed at via fuzzy name similarity.

**Not `Company`** — that was the originally-approved second field, until testing the backfill against real data (Step 3) showed its dominant values (`Ceas Comm` on 102/152 populated deals, plus variants) are CEAS's own internal business lines, not client identities; matching on it collapsed ~100 unrelated deals into one client and produced a false 100% repeat rate on the first backfilled quarter. `Client Name ` was substituted after verifying its values look like genuine distinct clients (`Twasool`, `Jamjoom Pharma`, etc.), at the cost of lower field coverage (50/196 vs. 152/196 for `Company`).

---

## 8. Freeze job (quarter-end snapshot)

`node-cron`, same mechanism `clickupReconcile.js` already uses. Fires at each calendar-quarter boundary (Cairo local, per §5). For the quarter `Q` that just closed, at close instant `T_close`:

```
cohort_size, <bucket>_count, conversion_1_rate, conversion_2_rate
  = exactly the §6 funnel-cohort formulas, but every bucket-events lookup adds `AND entered_at <= T_close`

repeat_clients_completed_count, repeat_clients_returned_count, repeat_client_rate
  = exactly the §6 repeat-client formulas, but the "returned" check adds `AND entered_at <= T_close`
```

Insert one row into `commercial_lead_quarter_snapshots` (`is_estimated = 0` — this is a live-tracking-era quarter, unlike the backfilled ones). The `UNIQUE(list_id, quarter)` constraint makes a duplicate run a no-op-with-conflict rather than a double insert; the job catches that conflict and logs it rather than crashing.

**Open item:** no automatic retry/alerting is designed for a missed or failed run — if the job doesn't fire, the quarter's snapshot is simply absent until someone notices and re-runs the underlying function manually. Acceptable for v1 given this is a low-frequency (4x/year), low-stakes-if-delayed-a-day job; flagged here rather than silently decided.

---

## 9. Implementation sequence

### Step 1 — Schema + shared bucket-mapping module — done

**Scope:** created both new tables, added the generated `origin_quarter` column to `commercial_lead_live_cache`, added `server/src/commercialLeadBuckets.js`. Nothing reads or writes the new tables yet.

**Implemented in `server/src/db.js`**: a `cairoQuarterExpr(column)` helper builds the §5 quarter expression once and is used for both `commercial_lead_bucket_events.event_quarter` (`STORED` — brand-new table) and `commercial_lead_live_cache.origin_quarter` (`VIRTUAL` — existing table with rows), so the formula can't diverge between the two.

**A real bug was caught during verification, not just assumed away:** the existing additive-migration guard pattern in this file (`db.prepare("PRAGMA table_info(...)").all()`, used to decide whether an `ALTER TABLE ADD COLUMN` has already run) silently omits generated columns from its output entirely — confirmed directly, not inferred from docs. Left as-is, this would have made the `origin_quarter` idempotency check always report the column missing, re-run `ALTER TABLE ADD COLUMN` on every server restart, and crash with `duplicate column name` starting on the second boot after this shipped. Fixed by switching that one query to `PRAGMA table_xinfo`, which does include generated columns (`hidden: 2` for `VIRTUAL`) and is confirmed to behave identically to `table_info` for the three existing ordinary-column checks already using it.

**Completion criteria — all verified against a full copy of the real local data file (196 real deals), not a synthetic one:**
- [x] Migration runs cleanly on first load
- [x] Migration is idempotent — re-loaded three consecutive times against the same already-migrated file with no error
- [x] `origin_quarter` distribution across real deals sums to exactly 196 (no rows dropped/miscounted); 2026-Q3 count (19) matches the figure independently computed earlier by direct date-range query in this same conversation
- [x] All five existing Commercial Lead read functions (`getDeals`, `getFunnel`, `getStatusColors`, `getDailyStats`, `getStageDurations`) run unchanged against the migrated schema and return the same shape/values as before — zero regression
- [x] `mapStatusToBucket()` verified against every real status value in use, including the misspelled `unqulified` and the excluded `complete`

**Rollback:** drop `commercial_lead_bucket_events`, `commercial_lead_quarter_snapshots`, and the `origin_quarter` column/index; delete `commercialLeadBuckets.js`. Nothing else depends on any of it yet.

### Step 2 — Live event capture
**Scope:** extend `clickupSync.js`'s status-change handling per §3.
**Completion criteria:** a real or staging status change that crosses a bucket produces exactly one new ledger row with the correct bucket and a real (not backfilled) `entered_at`; a lateral move within a bucket produces none; existing dashboard behavior unchanged (nothing reads the ledger yet).
**Rollback:** remove the insert call — ledger simply stops growing.

### Step 3 — One-time historical backfill — done

**Scope:** built `server/src/commercialLeadBackfill.js` (`npm run backfill:commercial-lead`), plus two new supporting modules it (and later steps) share: `commercialLeadQuarter.js` (extracted `cairoQuarterExpr` out of `db.js` so it's not duplicated, plus the new `quarterCloseTimestampUtc()` needed to bound a quarter-end snapshot query — verified to agree exactly with `cairoQuarterExpr`'s own classification at all four boundaries, not just argued to) and `commercialLeadQuarterMetrics.js` (`computeQuarterMetrics()`, the one implementation of the §6/§8 formulas that the backfill, and later Steps 4/5, all call rather than each computing it separately).

**Two real, materially-different-from-plan findings came out of testing this against actual data rather than synthetic fixtures:**

1. **The funnel-order backfill had to expand beyond "one row per deal."** Literally seeding one bucket_events row per deal (its current bucket only) would silently undercount every earlier stage for any deal that has since moved on — a deal currently `won` would show zero for qualified/onboarding/in_progress, since live-captured data logs every stage a deal actually passes through but a single backfilled row can't. Since leads→qualified→onboarding→in_progress→won is a confirmed strict sequence, `commercialLeadBuckets.js` gained `bucketsToBackfill()`: a deal currently at stage X gets one backfilled row for every stage up to and including X (all still dated at its creation date — an approximation of *when*, not *which* stages were reached). `lost` is excluded from this expansion — a deal can drop off from any stage, so there's no single implied path to backfill, and guessing one would be worse than the honest gap. Verified by hand-deriving the expected bucket counts from real deals' current-status distribution for the 2026-Q1 cohort and matching the script's output exactly (cohort 74; qualified/onboarding/in_progress/won/lost all matched the hand calculation).

2. **The approved identity-matching field (`Company`) turned out to be the wrong field, discovered by testing against real data, not caught by inspection.** Its dominant values (`Ceas Comm` on 102/152 populated deals) are CEAS's own internal business line, not client identity — matching on it collapsed ~100 unrelated deals into one false "client" and produced a nonsensical 100% repeat-client rate on the first backfilled quarter, which is what surfaced it. Flagged to the user rather than silently worked around; resolved by switching to `Client Name ` (50/196 populated, values look like genuine distinct clients) per explicit approval — see ADR-0010's "Identity matching" section for the full before/after. Re-verified after the fix: the same quarter's repeat rate dropped to the expected 0/1, with every other metric (which don't depend on identity matching) unchanged.

Also caught and fixed in passing: `mapStatusToBucket()` was missing the trailing space in ClickUp's actual `"in queue "` status value, silently dropping all 4 such deals from the funnel entirely (same quirk the pre-existing `commercialLead.js` already had to `.trim()` around for display) — found because the backfill reported 10 unmapped deals instead of the expected 6 (only `complete` should be unmapped).

**Completion criteria — verified against a full copy of real data, then applied for real:**
- [x] 190/196 deals backfilled (6 skipped: exactly the deals currently at the unmapped `complete` status, confirmed by direct count)
- [x] Re-running the script a second time against the same (already-backfilled) copy inserts nothing — confirmed idempotent
- [x] A snapshot row exists for every quarter with real cohort data through the one before current (2025-Q1 through 2026-Q2 — 6 quarters), all `is_estimated = 1`
- [x] 2025-Q1's single-deal cohort hand-verified end to end: bucket events, snapshot counts, and both conversion rates all matched by hand
- [x] 2026-Q1's full bucket breakdown (cohort 74; qualified 19, onboarding 5, in_progress 5, won 1, lost 52) hand-derived from the cohort's real current-status distribution and matched exactly
- [x] Existing dashboard read functions (`getDeals`, `getFunnel`) re-checked after backfill — unchanged, zero regression
- [x] Ran for real against the local database (not just a test copy) — 6 snapshots written, matching the verified test run exactly

**Rollback:** delete rows where `is_backfilled = 1` (ledger) and `is_estimated = 1` (snapshots) — returns to live-only state.

### Step 4 — Live dashboard: current quarter + cohort performance for any quarter — done

**Scope:** `commercialLead.js` gained `getQuarterlyKpis(requestedQuarter)`, calling `computeQuarterMetrics()` with `asOf: null` (live cohort performance, never the frozen snapshot table — that's Step 5's job, not this one). New route `GET /api/commercial-lead/quarterly-kpis?quarter=YYYY-Qn`, falling back to the current quarter for a missing/unrecognized value rather than erroring. The dashboard's old "0 new leads today" tile is replaced with a card showing all 9 metrics (Leads, Qualified, Onboarding, In Progress, Conversion 1, Conversion 2, Won, Lost, Repeat Client Rate) in a responsive grid, a quarter label with an "Includes estimated data" badge, and ‹ › navigation buttons that walk `availableQuarters` and disable at either end. Shipped ahead of the freeze job (Step 5) — every quarter, including already-closed ones, currently shows only its live figure; there's no frozen snapshot to compare against yet.

Also refactored in this step: `getCurrentQuarter()` and `getQuartersWithData()` moved into `commercialLeadQuarterMetrics.js` (shared by the dashboard and re-used by `commercialLeadBackfill.js`, which previously had its own local copies) — one implementation of "what quarter is it" and "which quarters have data," not two.

**Completion criteria — verified against the real local database via the actual running server, in a real browser, not just curl:**
- [x] All three response cases (default/current, explicit past quarter, invalid quarter) hit directly over HTTP and cross-checked by hand against the raw status breakdown — matched exactly, including reproducing the same 2026-Q1 numbers Step 3's backfill already printed
- [x] Logged into the real dashboard in Chrome and confirmed the rendered tiles match the API response exactly for the current quarter (19/12/2/1/5.3%/0.0%/0/4/n/a)
- [x] Clicked ‹ five times from the current quarter down to 2025-Q1 (the earliest with data) — numbers updated correctly at each step, matched Step 3's backfill output, and the button correctly stopped/disabled at the boundary despite further clicks
- [x] Clicked › eight times back up to the current quarter — same checks, correctly disabled at the other boundary
- [x] Zero console errors on a fresh page load
- [x] Rest of the page (funnel, live-deals table, filters) re-screenshotted and confirmed unaffected — no regression from the HTML/CSS/JS changes
- [x] Test user and browser tab used for verification cleaned up afterward

**Rollback:** revert the UI and route — read-only, no data risk.

### Step 5 — Freeze job — done

**Scope:** `server/src/commercialLeadFreeze.js` — `freezeQuarter(quarter)` (the §8 computation, sharing `computeQuarterMetrics()` with everything else rather than a fourth implementation) and `scheduleQuarterFreeze()` (the `node-cron` trigger), wired into `index.js` alongside the existing reconciliation schedule. `commercialLeadQuarterMetrics.js` gained `getQuarterSnapshot()`; `getQuarterlyKpis()` now returns a `snapshot` field (`null` for the open current quarter, populated for any quarter that's been frozen). The dashboard shows the live figure as the primary number in every tile, with a small "at close: X" line appearing under a tile only when the frozen and live values actually differ — not a full duplicate second grid, which would mostly just repeat identical numbers.

**One refinement beyond the original scope, decided during implementation:** rather than a purely fixed cron expression, the scheduling uses `node-cron`'s native `timezone: 'Africa/Cairo'` option, which delegates to Node's own ICU/IANA timezone data — the real DST rule, not this project's SQL-side approximation. Checked directly: `new Date('2026-09-30T21:00:00.000Z')` formatted in `Africa/Cairo` resolves to `10/1/2026, 12:00:00 AM GMT+3` — exactly the boundary this project's own `quarterCloseTimestampUtc()` already computes for that same quarter, independently confirming the two approaches agree. Node's tz-awareness is used only to decide *when* to fire; *which* quarter closed and its exact boundary for the query are still computed via this project's own deterministic function, so there's one source for the data value and a second, independently-verified-correct source for trigger timing — not two competing implementations of the same thing.

**Also beyond the original "manual-recovery-only" scope** (§8's noted open item): `scheduleQuarterFreeze()` runs one startup catch-up call, mirroring `clickupReconcile.js`'s own rationale — if the server was down exactly when a quarter boundary passed, the next boot still freezes it, rather than requiring someone to notice and manually re-run the function. Idempotent either way, so this is a free improvement, not a design risk.

**Completion criteria — verified against real data via the actual computation path, a genuinely diverged scenario, and the real running server:**
- [x] `freezeQuarter()` on an already-frozen quarter (2026-Q2, from Step 3's backfill) correctly detects the `UNIQUE` conflict and skips without crashing
- [x] `freezeQuarter()` on a quarter with no snapshot yet produces numbers that exactly match a direct `computeQuarterMetrics()` call at the identical `asOf` boundary — byte-for-byte equal, not just close
- [x] Re-freezing the same quarter a second time is a no-op — confirmed idempotent
- [x] Real server startup (against the real database) logs the schedule registering and the startup catch-up correctly identifying 2026-Q2 as already-frozen — no crash, no unwanted write
- [x] Built a genuine divergence scenario (gave a 2026-Q2 deal a real post-close `won` event) and confirmed via the actual API response that `metrics.wonCount` (live) and `snapshot.wonCount` (frozen) correctly differ (1 vs. 0)
- [x] Confirmed visually in a real browser against that diverged data: only the two tiles that actually differ (Won, Conversion 2) show the "at close" comparison line; the seven identical tiles stay clean, and the "Frozen at close" badge appears
- [x] All test users, tabs, and the throwaway diverge-test database copy cleaned up afterward

One test artifact intentionally left alone rather than force-cleaned: a pre-existing pricing-portal browser tab had an unrelated "unsaved changes" guard blocking navigation/close — left untouched rather than discarding state that wasn't mine to discard; flagged to the user directly.

**Rollback:** disable the cron schedule — existing snapshot rows remain as historical record; Step 4's live view has no dependency on this job.

---

## Open items requiring resolution before/at implementation

**Resolved:**
- ~~Egypt's current DST/offset rule for the quarter expression~~ — verified against Law No. 24 of 2023 and empirically tested against both the `sqlite3` CLI and the app's actual `better-sqlite3` driver; see §5.
- ~~Which exact ClickUp field/payload value should populate `entered_at`~~ — resolved by reading the existing code rather than guessing: it uses the sync's own observed timestamp, not any ClickUp-supplied field, matching the pattern `stage_history`/`stage_tracking` already use; see §3.
- ~~Freeze-job failure handling~~ — improved beyond the originally-accepted "manual-recovery-only": a startup catch-up call means a missed cron fire (server down at the boundary) self-heals on the next boot, not just on someone noticing and re-running it by hand; see Step 5.

**Still open — not resolved by this implementation, doesn't block anything already shipped:**
1. `complete` status's operational meaning, to decide whether/how it eventually joins the funnel (ADR-0010) — affects the bucket-mapping module only in that `complete` stays unmapped.
