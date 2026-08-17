const cron = require('node-cron');
const db = require('./db');
const logger = require('./common/logger');
const { quarterCloseTimestampUtc, previousQuarter } = require('./commercialLeadQuarter');
const { computeQuarterMetrics, getCurrentQuarter, hasBackfilledData } = require('./commercialLeadQuarterMetrics');
const { LISTS } = require('./commercialLead');

/* Writes the one immutable commercial_lead_quarter_snapshots row for a
   quarter — "what we reported at the instant it closed" (ADR-0010), never
   updated after. asOf is computed deterministically from the quarter
   label itself (quarterCloseTimestampUtc), not from wall-clock "now" at
   fire time, so a re-run (retry, manual catch-up) always reproduces the
   exact same numbers rather than drifting with whenever it happens to run.
   is_estimated reflects whether this quarter's own cohort relies on any
   backfilled data — true for a while yet even for freshly-closing
   quarters, since the historical backfill (Step 3) seeded a baseline for
   every deal that existed before live tracking began, including ones in
   the quarter that's closing now. */
function freezeQuarter(quarter) {
  const listId = LISTS.pipeline;
  const asOf = quarterCloseTimestampUtc(quarter);
  const metrics = computeQuarterMetrics({ listId, quarter, asOf });
  const isEstimated = hasBackfilledData({ listId, quarter });

  try {
    db.prepare(`
      INSERT INTO commercial_lead_quarter_snapshots (
        list_id, quarter, cohort_size, qualified_count, onboarding_count, in_progress_count,
        won_count, lost_count, conversion_1_rate, conversion_2_rate,
        repeat_clients_completed_count, repeat_clients_returned_count, repeat_client_rate,
        is_estimated, frozen_at
      ) VALUES (
        @listId, @quarter, @cohortSize, @qualifiedCount, @onboardingCount, @inProgressCount,
        @wonCount, @lostCount, @conversion1Rate, @conversion2Rate,
        @repeatClientsCompletedCount, @repeatClientsReturnedCount, @repeatClientRate,
        @isEstimated, @frozenAt
      )
    `).run({
      listId,
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
      isEstimated: isEstimated ? 1 : 0,
      frozenAt: new Date().toISOString(),
    });
    logger.info('Commercial Lead quarter snapshot frozen.', { quarter, ...metrics, isEstimated });
    return { quarter, frozen: true, metrics };
  } catch (error) {
    // UNIQUE(list_id, quarter) — already frozen (a prior run, a retry, or
    // this same job firing twice). Not an error: freezing is meant to
    // happen exactly once per quarter, ever.
    if (/UNIQUE constraint failed/.test(error.message)) {
      logger.info('Commercial Lead quarter snapshot already exists — skipping.', { quarter });
      return { quarter, frozen: false, reason: 'already-frozen' };
    }
    throw error;
  }
}

/* Fires at each calendar-quarter boundary in Cairo local time — node-cron's
   own `timezone` option delegates to Node's ICU/IANA timezone data, which
   handles Egypt's real DST rule (Law No. 24/2023) natively and correctly,
   independently cross-checked against this project's own SQL-side
   approximation (docs/commercial-lead-quarterly-kpis-plan.md §5) for the
   same boundary and found to agree exactly. That native tz-awareness is
   used only to decide WHEN to fire; WHICH quarter closed and its exact
   boundary are still computed via this project's own
   quarterCloseTimestampUtc(), the same deterministic function the
   historical backfill already uses — one source for the data value, kept
   separate from the (also correct, independently verified) trigger timing. */
function scheduleQuarterFreeze() {
  cron.schedule(
    '0 0 1 1,4,7,10 *',
    () => {
      const closingQuarter = previousQuarter(getCurrentQuarter());
      freezeQuarter(closingQuarter);
    },
    { timezone: 'Africa/Cairo' }
  );
  logger.info('Commercial Lead quarter-freeze scheduled for quarter boundaries (Africa/Cairo).');

  // Startup catch-up: if the server was down exactly when a boundary
  // passed (a redeploy, an outage), the next boot still freezes the
  // quarter that closed while nothing was running — mirrors
  // clickupReconcile.js's own startup-run rationale. Idempotent either way.
  const closingQuarter = previousQuarter(getCurrentQuarter());
  freezeQuarter(closingQuarter);
}

module.exports = { freezeQuarter, scheduleQuarterFreeze };
