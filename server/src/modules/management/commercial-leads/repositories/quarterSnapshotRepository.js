/* commercial_lead_quarter_snapshots — one immutable row per (list, quarter),
   written once by the freeze job or the historical backfill, never updated
   after. Extracted unchanged from commercialLeadFreeze.js/
   commercialLeadBackfill.js/commercialLeadQuarterMetrics.js.
   insert() deliberately does NOT catch the UNIQUE(list_id, quarter)
   violation — whether "already frozen" is an error or an expected no-op is
   a business decision for the caller (freezeService), not a SQL concern. */
const db = require('../../../../db');

function insert(row) {
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
  `).run(row);
}

function findByListAndQuarter(listId, quarter) {
  return db.prepare('SELECT * FROM commercial_lead_quarter_snapshots WHERE list_id = ? AND quarter = ?').get(listId, quarter);
}

function listQuartersByListId(listId) {
  return db.prepare('SELECT quarter FROM commercial_lead_quarter_snapshots WHERE list_id = ?').all(listId).map((r) => r.quarter);
}

module.exports = { insert, findByListAndQuarter, listQuartersByListId };
