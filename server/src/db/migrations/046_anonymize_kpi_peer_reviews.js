/* Team reviews become anonymous in the data itself, not only by access
   control (user decision 2026-10-07: "unlinkable in the DB").
   kpi_peer_review_responses stored each answer next to the reviewer who
   gave it, so anyone with database access — or the audit log's timestamps
   — could trace a score or comment back to a person. It is split in two:

   - kpi_peer_review_submissions: only "this reviewer has submitted for
     this reviewee this quarter". Blocks a second submission (reviews can't
     be edited — same decision) and drives completion counts. No scores.
   - kpi_peer_review_answers: the scores and comment, with no reviewer,
     no timestamp and a random id. WITHOUT ROWID, so rows are stored in
     random-id order — not insertion order, which would line up with the
     submission times.

   Existing answers are copied across with fresh random ids and the old
   table is dropped. VACUUM then rewrites the file so the dropped pages —
   which still held reviewer + answer side by side — don't linger on disk.
   Older backups taken before this migration still contain the linked
   rows; that is an operations concern, not something a migration can fix. */
function up(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE kpi_peer_review_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reviewer_employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        reviewee_employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        quarter TEXT NOT NULL,
        submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (reviewer_employee_id, reviewee_employee_id, quarter),
        CHECK (reviewer_employee_id <> reviewee_employee_id)
      );
      CREATE INDEX idx_kpi_peer_review_submissions_reviewer_quarter ON kpi_peer_review_submissions(reviewer_employee_id, quarter);

      CREATE TABLE kpi_peer_review_answers (
        id TEXT PRIMARY KEY,
        reviewee_employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        quarter TEXT NOT NULL,
        worked_with INTEGER NOT NULL CHECK (worked_with IN (0, 1)),
        communication REAL CHECK (communication BETWEEN 0 AND 10),
        collaboration REAL CHECK (collaboration BETWEEN 0 AND 10),
        reliability REAL CHECK (reliability BETWEEN 0 AND 10),
        attitude REAL CHECK (attitude BETWEEN 0 AND 10),
        contribution REAL CHECK (contribution BETWEEN 0 AND 10),
        growth REAL CHECK (growth BETWEEN 0 AND 10),
        comment TEXT
      ) WITHOUT ROWID;
      CREATE INDEX idx_kpi_peer_review_answers_reviewee_quarter ON kpi_peer_review_answers(reviewee_employee_id, quarter);

      INSERT INTO kpi_peer_review_submissions (reviewer_employee_id, reviewee_employee_id, quarter, submitted_at)
        SELECT reviewer_employee_id, reviewee_employee_id, quarter, submitted_at FROM kpi_peer_review_responses;

      INSERT INTO kpi_peer_review_answers
        (id, reviewee_employee_id, quarter, worked_with, communication, collaboration, reliability, attitude, contribution, growth, comment)
        SELECT lower(hex(randomblob(16))), reviewee_employee_id, quarter, worked_with,
               communication, collaboration, reliability, attitude, contribution, growth, comment
        FROM kpi_peer_review_responses
        ORDER BY random();

      DROP TABLE kpi_peer_review_responses;
    `);
  })();
  db.exec('VACUUM');
  db.pragma('wal_checkpoint(TRUNCATE)');
}

module.exports = { up };
