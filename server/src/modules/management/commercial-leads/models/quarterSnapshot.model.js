/* Row-mapper for commercial_lead_quarter_snapshots. Extracted unchanged
   from the old commercialLeadQuarterMetrics.js's getQuarterSnapshot. */
function toQuarterSnapshot(row) {
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

module.exports = { toQuarterSnapshot };
