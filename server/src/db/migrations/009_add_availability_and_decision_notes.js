/* Plain ADD COLUMN, same reasoning as 007/008 — no table rebuild needed.

   `availability` replaces `half_day`/`half_day_period` going forward — those
   two columns are left in place (unused by new code) rather than dropped,
   so existing rows keep their history and no data-migrating rebuild is
   required. New code writes `availability` only; the model still maps the
   legacy columns so old rows can still render something meaningful.

   `manager_decision_note`/`pc_decision_note` mirror the existing
   manager_decision_by/at vs pc_confirmed_by/at split — each decision stage
   gets its own note column, required by the service layer only when that
   stage's decision is 'rejected'. */
function up(db) {
  db.exec(`
    ALTER TABLE leave_requests ADD COLUMN availability TEXT CHECK (availability IN ('full_day','partial_day','unavailable'));
    ALTER TABLE leave_requests ADD COLUMN manager_decision_note TEXT;
    ALTER TABLE leave_requests ADD COLUMN pc_decision_note TEXT;
  `);
}

module.exports = { up };
