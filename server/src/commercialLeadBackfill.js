// One-time (per environment) historical backfill for the quarterly KPI
// feature — see docs/commercial-lead-quarterly-kpis-plan.md §4.
// Seeds commercial_lead_bucket_events for every deal that predates live
// tracking (clickupSync.js, shipped Step 2), then computes and freezes a
// commercial_lead_quarter_snapshots row for every calendar quarter that had
// already closed before this system existed. Safe to re-run: both halves
// skip anything already present rather than duplicating it.
//
// Usage: node src/commercialLeadBackfill.js

const db = require('./db');
const { mapStatusToBucket, bucketsToBackfill } = require('./commercialLeadBuckets');
const { quarterCloseTimestampUtc } = require('./commercialLeadQuarter');
const { computeQuarterMetrics, getCurrentQuarter, getQuartersWithData } = require('./commercialLeadQuarterMetrics');

const LIST_ID = '901518274897'; // 2026 Projects — see docs/adr/0010-commercial-lead-quarterly-kpis.md

function backfillLedger() {
  // Deal-level idempotency: skip any deal that already has ANY ledger row
  // (real or backfilled) — not just an is_backfilled one. A deal could
  // already have real, live-captured events by the time this script runs
  // or re-runs (a brand-new deal created after Step 2 shipped, or an
  // existing one whose status has genuinely changed since); backfilling a
  // creation-time approximation on top of already-accurate real data would
  // duplicate/confuse its history rather than fill a real gap.
  const alreadyTracked = new Set(
    db.prepare('SELECT DISTINCT deal_id FROM commercial_lead_bucket_events').all().map((r) => r.deal_id)
  );

  const deals = db
    .prepare('SELECT deal_id, status, clickup_created_at FROM commercial_lead_live_cache WHERE list_id = ?')
    .all(LIST_ID);

  const insert = db.prepare(`
    INSERT INTO commercial_lead_bucket_events (deal_id, list_id, bucket, entered_at, is_backfilled)
    VALUES (?, ?, ?, ?, 1)
  `);

  let dealsInserted = 0;
  let rowsInserted = 0;
  let skippedAlreadyTracked = 0;
  let skippedUnmapped = 0;
  let skippedNoDate = 0;

  const tx = db.transaction(() => {
    for (const deal of deals) {
      if (alreadyTracked.has(deal.deal_id)) {
        skippedAlreadyTracked += 1;
        continue;
      }
      if (!deal.clickup_created_at) {
        skippedNoDate += 1;
        continue;
      }
      const bucket = mapStatusToBucket(deal.status);
      const buckets = bucketsToBackfill(bucket);
      if (buckets.length === 0) {
        skippedUnmapped += 1;
        continue;
      }
      for (const b of buckets) {
        insert.run(deal.deal_id, LIST_ID, b, deal.clickup_created_at);
        rowsInserted += 1;
      }
      dealsInserted += 1;
    }
  });
  tx();

  return { total: deals.length, dealsInserted, rowsInserted, skippedAlreadyTracked, skippedUnmapped, skippedNoDate };
}

function closedQuartersWithData() {
  const nowQ = getCurrentQuarter();
  return getQuartersWithData(LIST_ID).filter((q) => q < nowQ);
}

function backfillSnapshots() {
  const existing = new Set(
    db.prepare('SELECT quarter FROM commercial_lead_quarter_snapshots WHERE list_id = ?').all(LIST_ID).map((r) => r.quarter)
  );

  const insert = db.prepare(`
    INSERT INTO commercial_lead_quarter_snapshots (
      list_id, quarter, cohort_size, qualified_count, onboarding_count, in_progress_count,
      won_count, lost_count, conversion_1_rate, conversion_2_rate,
      repeat_clients_completed_count, repeat_clients_returned_count, repeat_client_rate,
      is_estimated, frozen_at
    ) VALUES (
      @listId, @quarter, @cohortSize, @qualifiedCount, @onboardingCount, @inProgressCount,
      @wonCount, @lostCount, @conversion1Rate, @conversion2Rate,
      @repeatClientsCompletedCount, @repeatClientsReturnedCount, @repeatClientRate,
      1, @frozenAt
    )
  `);

  let inserted = 0;
  let skipped = 0;
  const results = [];

  for (const quarter of closedQuartersWithData()) {
    if (existing.has(quarter)) {
      skipped += 1;
      continue;
    }
    const asOf = quarterCloseTimestampUtc(quarter);
    const metrics = computeQuarterMetrics({ listId: LIST_ID, quarter, asOf });
    insert.run({
      listId: LIST_ID,
      quarter,
      cohortSize: metrics.cohortSize,
      qualifiedCount: metrics.qualifiedCount,
      onboardingCount: metrics.onboardingCount,
      inProgressCount: metrics.inProgressCount,
      wonCount: metrics.wonCount,
      lostCount: metrics.lostCount,
      conversion1Rate: metrics.conversion1Rate,
      conversion2Rate: metrics.conversion2Rate,
      repeatClientsCompletedCount: metrics.repeatClientsCompletedCount,
      repeatClientsReturnedCount: metrics.repeatClientsReturnedCount,
      repeatClientRate: metrics.repeatClientRate,
      frozenAt: new Date().toISOString(),
    });
    inserted += 1;
    results.push({ quarter, ...metrics });
  }

  return { inserted, skipped, results };
}

function main() {
  console.log(`Backfilling commercial_lead_bucket_events for list ${LIST_ID}...`);
  const ledgerResult = backfillLedger();
  console.log(
    `  ${ledgerResult.dealsInserted}/${ledgerResult.total} deals backfilled (${ledgerResult.rowsInserted} ledger rows). ` +
      `Skipped: ${ledgerResult.skippedAlreadyTracked} already tracked, ${ledgerResult.skippedUnmapped} unmapped status, ${ledgerResult.skippedNoDate} missing creation date.`
  );

  console.log('Backfilling commercial_lead_quarter_snapshots for closed quarters...');
  const snapshotResult = backfillSnapshots();
  console.log(`  ${snapshotResult.inserted} snapshot(s) written, ${snapshotResult.skipped} already existed.`);
  for (const r of snapshotResult.results) {
    console.log(
      `    ${r.quarter}: cohort=${r.cohortSize} qualified=${r.qualifiedCount} onboarding=${r.onboardingCount} ` +
        `inProgress=${r.inProgressCount} won=${r.wonCount} lost=${r.lostCount} ` +
        `conv1=${r.conversion1Rate === null ? 'n/a' : r.conversion1Rate.toFixed(2)} ` +
        `conv2=${r.conversion2Rate === null ? 'n/a' : r.conversion2Rate.toFixed(2)} ` +
        `repeat=${r.repeatClientRate === null ? 'n/a' : r.repeatClientRate.toFixed(2)} ` +
        `(${r.repeatClientsReturnedCount}/${r.repeatClientsCompletedCount})`
    );
  }
  console.log('Done.');
}

if (require.main === module) {
  main();
}

module.exports = { backfillLedger, backfillSnapshots, closedQuartersWithData };
