/* kpi_peer_review_responses — the raw, per-reviewer rows behind the hosted
   "everyone reviews everyone" Pillar A review. Anonymity is enforced by
   ACCESS CONTROL, not data absence: reviewer_employee_id is required here
   (to block duplicate submissions, let a reviewer edit their own response
   before the window closes, and track completion), but no controller or
   service function anywhere in this module ever returns it in a response
   body, and no view ever joins it to a name — the same boundary
   kpi_pillar_a_reviews' own schema comment already draws for the
   aggregate table, made explicit here for the raw one. worked_with=0
   means the reviewer explicitly said "didn't work with them" — the
   dimension columns stay null in that case, not zero, so a "didn't work
   with them" response never drags the aggregate average down. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_peer_review_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reviewer_employee_id INTEGER NOT NULL,
      reviewee_employee_id INTEGER NOT NULL,
      quarter TEXT NOT NULL,
      worked_with INTEGER NOT NULL DEFAULT 1,
      communication REAL,
      collaboration REAL,
      reliability REAL,
      attitude REAL,
      contribution REAL,
      growth REAL,
      comment TEXT,
      submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(reviewer_employee_id, reviewee_employee_id, quarter),
      FOREIGN KEY(reviewer_employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
      FOREIGN KEY(reviewee_employee_id) REFERENCES employees(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_kpi_peer_review_reviewee_quarter ON kpi_peer_review_responses(reviewee_employee_id, quarter);
    CREATE INDEX IF NOT EXISTS idx_kpi_peer_review_reviewer_quarter ON kpi_peer_review_responses(reviewer_employee_id, quarter);
  `);
}

module.exports = { up };
