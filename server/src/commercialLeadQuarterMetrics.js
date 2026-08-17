const db = require('./db');
const { cairoQuarterExpr } = require('./commercialLeadQuarter');

/* Shared computation for a single quarter's funnel + repeat-client metrics,
   used identically by: the historical snapshot backfill (this step), the
   live current-quarter/cohort-performance dashboard reads (Step 4), and the
   quarter-close freeze job (Step 5) — one implementation, called with
   different `asOf` values, rather than three copies that could drift.

   asOf = null            -> "cohort performance, as of now" (live, never stored)
   asOf = an ISO timestamp -> "quarter-end snapshot, as it stood at that instant" (frozen)

   See docs/adr/0010-commercial-lead-quarterly-kpis.md for why these two
   modes are kept conceptually distinct, and
   docs/commercial-lead-quarterly-kpis-plan.md §6-§7 for the formulas this
   implements verbatim. */

function normalizeIdentityField(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

/* Union-find over deal_id -> client identity, matching on Email OR
   normalized Client Name (ADR-0010 §"Identity matching"). This is a
   transitive relation, not a simple single-key grouping: deal A matching
   deal B on email and B matching deal C on client name means A/B/C are all
   the same client, even though A and C share neither field directly — a
   plain GROUP BY email-or-name would miss that. Deals with neither field
   populated are excluded entirely (resolve() returns null for them), never
   guessed at via fuzzy matching.

   NOT Company: verified against real deal data during Step 3 implementation
   that the `Company` custom field is CEAS's own internal business line
   (~102/152 populated deals are literally "Ceas Comm"), not the client's
   identity — using it collapsed ~100 unrelated clients into one false
   "repeat" match. `Client Name ` (trailing space is real, matches
   ClickUp's actual field name) has lower coverage (50/196 vs 152/196) but
   its values look like real, distinct client businesses. */
function buildClientIdentityResolver(listId) {
  const rows = db.prepare('SELECT deal_id, fields_json FROM commercial_lead_live_cache WHERE list_id = ?').all(listId);

  const parent = new Map();
  function find(id) {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const byEmail = new Map();
  const byClientName = new Map();
  const hasIdentity = new Set();
  const dealsByClient = new Map();

  for (const row of rows) {
    const fields = JSON.parse(row.fields_json || '{}');
    const email = normalizeIdentityField(fields['Email']?.value);
    const clientName = normalizeIdentityField(fields['Client Name ']?.value);
    if (!email && !clientName) continue; // unmatchable — excluded on both sides, not guessed at

    hasIdentity.add(row.deal_id);
    find(row.deal_id); // ensure a parent entry exists even if this deal never unions with another
    if (email) {
      if (byEmail.has(email)) union(row.deal_id, byEmail.get(email));
      else byEmail.set(email, row.deal_id);
    }
    if (clientName) {
      if (byClientName.has(clientName)) union(row.deal_id, byClientName.get(clientName));
      else byClientName.set(clientName, row.deal_id);
    }
  }

  const resolve = (dealId) => (hasIdentity.has(dealId) ? find(dealId) : null);

  for (const row of rows) {
    const clientId = resolve(row.deal_id);
    if (!clientId) continue;
    if (!dealsByClient.has(clientId)) dealsByClient.set(clientId, []);
    dealsByClient.get(clientId).push(row.deal_id);
  }

  return { resolve, dealsByClient };
}

function computeQuarterMetrics({ listId, quarter, asOf }) {
  const ceiling = asOf ? 'AND entered_at < @asOf' : '';
  const params = { listId, quarter, asOf: asOf || null };

  const cohortSize = db.prepare(`
    SELECT COUNT(*) AS n FROM commercial_lead_live_cache WHERE list_id = @listId AND origin_quarter = @quarter
  `).get(params).n;

  function bucketCount(bucket) {
    return db.prepare(`
      SELECT COUNT(DISTINCT e.deal_id) AS n
      FROM commercial_lead_bucket_events e
      JOIN commercial_lead_live_cache d ON d.deal_id = e.deal_id
      WHERE d.list_id = @listId AND d.origin_quarter = @quarter AND e.bucket = @bucket ${ceiling}
    `).get({ ...params, bucket }).n;
  }

  const qualifiedCount = bucketCount('qualified');
  const onboardingCount = bucketCount('onboarding');
  const inProgressCount = bucketCount('in_progress');
  const wonCount = bucketCount('won');
  const lostCount = bucketCount('lost');

  const conversion1Rate = cohortSize > 0 ? inProgressCount / cohortSize : null;
  const conversion2Rate = inProgressCount > 0 ? wonCount / inProgressCount : null;

  // Repeat Client Rate — anchored on the Won event's OWN event_quarter, not origin_quarter (ADR-0010).
  const wonThisQuarter = db.prepare(`
    SELECT deal_id, entered_at FROM commercial_lead_bucket_events
    WHERE list_id = @listId AND bucket = 'won' AND event_quarter = @quarter
  `).all(params);

  const { resolve, dealsByClient } = buildClientIdentityResolver(listId);

  const earliestWonByClient = new Map(); // clientId -> earliest Won entered_at this quarter
  for (const row of wonThisQuarter) {
    const clientId = resolve(row.deal_id);
    if (!clientId) continue; // unmatchable — excluded entirely
    const existing = earliestWonByClient.get(clientId);
    if (!existing || row.entered_at < existing) earliestWonByClient.set(clientId, row.entered_at);
  }

  const repeatClientsCompletedCount = earliestWonByClient.size;

  const hasLaterLeadsStmt = db.prepare(`
    SELECT 1 FROM commercial_lead_bucket_events
    WHERE deal_id = @dealId AND bucket = 'leads' AND entered_at > @wonEnteredAt ${ceiling}
    LIMIT 1
  `);

  let repeatClientsReturnedCount = 0;
  for (const [clientId, wonEnteredAt] of earliestWonByClient) {
    const dealIds = dealsByClient.get(clientId) || [];
    const returned = dealIds.some((dealId) => hasLaterLeadsStmt.get({ ...params, dealId, wonEnteredAt }));
    if (returned) repeatClientsReturnedCount += 1;
  }

  const repeatClientRate = repeatClientsCompletedCount > 0 ? repeatClientsReturnedCount / repeatClientsCompletedCount : null;

  return {
    cohortSize,
    qualifiedCount,
    onboardingCount,
    inProgressCount,
    wonCount,
    lostCount,
    conversion1Rate,
    conversion2Rate,
    repeatClientsCompletedCount,
    repeatClientsReturnedCount,
    repeatClientRate,
  };
}

/* Single implementation of "what quarter is it right now" — reused by the
   backfill script (to know which quarters already closed) and the live
   dashboard (to default to the current quarter and to tell it apart from
   past ones in the response). Delegates to the same cairoQuarterExpr the
   generated columns use, rather than a separate JS reimplementation. */
function getCurrentQuarter() {
  return db.prepare(`SELECT (${cairoQuarterExpr("datetime('now')")}) AS q`).get().q;
}

/* Every distinct origin_quarter with at least one deal, ascending — the
   full set of quarters that could ever be shown (current + all past, live
   and backfilled alike). Callers filter further as needed (the backfill
   script excludes the current, still-open quarter; the dashboard doesn't). */
function getQuartersWithData(listId) {
  return db
    .prepare(
      `SELECT DISTINCT origin_quarter FROM commercial_lead_live_cache
       WHERE list_id = ? AND origin_quarter IS NOT NULL
       ORDER BY origin_quarter`
    )
    .all(listId)
    .map((r) => r.origin_quarter);
}

/* Whether ANY of a quarter's cohort deals rely on backfilled (rather than
   live-observed) ledger data — a per-quarter flag, not per-metric, since
   splitting "this specific number is exact" from "this one is estimated"
   at finer granularity isn't worth the complexity yet. The dashboard badges
   the whole quarter's view as including estimated data when this is true. */
function hasBackfilledData({ listId, quarter }) {
  const row = db
    .prepare(
      `SELECT 1
       FROM commercial_lead_bucket_events e
       JOIN commercial_lead_live_cache d ON d.deal_id = e.deal_id
       WHERE d.list_id = @listId AND d.origin_quarter = @quarter AND e.is_backfilled = 1
       LIMIT 1`
    )
    .get({ listId, quarter });
  return !!row;
}

/* The frozen quarter-end snapshot, if one has been written for this
   quarter (Step 5's freeze job, or the historical backfill) — null for the
   still-open current quarter, which never gets one, and for a closed
   quarter the freeze job hasn't reached yet (shouldn't happen for any
   already-closed quarter once Step 5 is live, but a fresh install between
   backfill and the job's first run could briefly have a gap). Deliberately
   a separate read from computeQuarterMetrics — ADR-0010's whole point is
   that these two are different questions with different answers, never
   merged into one. */
function getQuarterSnapshot(listId, quarter) {
  const row = db
    .prepare('SELECT * FROM commercial_lead_quarter_snapshots WHERE list_id = ? AND quarter = ?')
    .get(listId, quarter);
  if (!row) return null;
  return {
    cohortSize: row.cohort_size,
    qualifiedCount: row.qualified_count,
    onboardingCount: row.onboarding_count,
    inProgressCount: row.in_progress_count,
    wonCount: row.won_count,
    lostCount: row.lost_count,
    conversion1Rate: row.conversion_1_rate,
    conversion2Rate: row.conversion_2_rate,
    repeatClientsCompletedCount: row.repeat_clients_completed_count,
    repeatClientsReturnedCount: row.repeat_clients_returned_count,
    repeatClientRate: row.repeat_client_rate,
    isEstimated: !!row.is_estimated,
    frozenAt: row.frozen_at,
  };
}

module.exports = {
  computeQuarterMetrics,
  buildClientIdentityResolver,
  getCurrentQuarter,
  getQuartersWithData,
  hasBackfilledData,
  getQuarterSnapshot,
};
