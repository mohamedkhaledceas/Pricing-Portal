/* commercial_lead_bucket_events — permanent, append-only ledger, one row
   per time a deal crosses INTO a funnel bucket. Extracted unchanged from
   clickupSync.js/commercialLeadBackfill.js/commercialLeadQuarterMetrics.js. */
const db = require('../../../../db');

function insert({ dealId, listId, bucket, enteredAt, isBackfilled = false }) {
  db.prepare(`
    INSERT INTO commercial_lead_bucket_events (deal_id, list_id, bucket, entered_at, is_backfilled)
    VALUES (?, ?, ?, ?, ?)
  `).run(dealId, listId, bucket, enteredAt, isBackfilled ? 1 : 0);
}

function listTrackedDealIds() {
  return db.prepare('SELECT DISTINCT deal_id FROM commercial_lead_bucket_events').all().map((r) => r.deal_id);
}

/* asOf, if given, bounds the count to events observed before that instant —
   the "frozen snapshot as it stood then" mode (see quarterMetricsService). */
function countDistinctDealsInBucket({ listId, quarter, bucket, asOf }) {
  const ceiling = asOf ? 'AND e.entered_at < @asOf' : '';
  return db
    .prepare(
      `SELECT COUNT(DISTINCT e.deal_id) AS n
       FROM commercial_lead_bucket_events e
       JOIN commercial_lead_live_cache d ON d.deal_id = e.deal_id
       WHERE d.list_id = @listId AND d.origin_quarter = @quarter AND e.bucket = @bucket ${ceiling}`
    )
    .get({ listId, quarter, bucket, asOf: asOf || null }).n;
}

function findWonInQuarter({ listId, quarter }) {
  return db
    .prepare(
      `SELECT deal_id, entered_at FROM commercial_lead_bucket_events
       WHERE list_id = ? AND bucket = 'won' AND event_quarter = ?`
    )
    .all(listId, quarter);
}

function hasLaterLeadsEntry({ dealId, wonEnteredAt, asOf }) {
  const ceiling = asOf ? 'AND entered_at < @asOf' : '';
  const row = db
    .prepare(
      `SELECT 1 FROM commercial_lead_bucket_events
       WHERE deal_id = @dealId AND bucket = 'leads' AND entered_at > @wonEnteredAt ${ceiling}
       LIMIT 1`
    )
    .get({ dealId, wonEnteredAt, asOf: asOf || null });
  return !!row;
}

function hasBackfilledDataForQuarter({ listId, quarter }) {
  const row = db
    .prepare(
      `SELECT 1
       FROM commercial_lead_bucket_events e
       JOIN commercial_lead_live_cache d ON d.deal_id = e.deal_id
       WHERE d.list_id = ? AND d.origin_quarter = ? AND e.is_backfilled = 1
       LIMIT 1`
    )
    .get(listId, quarter);
  return !!row;
}

module.exports = {
  insert,
  listTrackedDealIds,
  countDistinctDealsInBucket,
  findWonInQuarter,
  hasLaterLeadsEntry,
  hasBackfilledDataForQuarter,
};
