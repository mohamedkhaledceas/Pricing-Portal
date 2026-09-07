/* kpi_review_windows — per-quarter, P&C/admin-configurable open/close
   dates for the peer review period. Deliberately not day-count-derived
   (e.g. "always opens 14 days before close") so a shifted quarter
   timeline can be reflected by editing one row, not a code change. No
   row for a quarter means the review isn't open yet for it — see
   kpiPeerReviewService.getWindow's default-suggestion behavior for what
   the UI proposes before P&C ever sets one explicitly. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_review_windows (
      quarter TEXT PRIMARY KEY,
      opens_at TEXT NOT NULL,
      closes_at TEXT NOT NULL,
      set_by INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(set_by) REFERENCES employees(id) ON DELETE RESTRICT
    );
  `);
}

module.exports = { up };
