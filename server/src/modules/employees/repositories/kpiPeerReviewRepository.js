/* kpi_peer_review_responses — only SQL here. Every read in this file is
   used only internally by kpiPeerReviewService for aggregation/completion
   tracking — see that service for the access-control boundary that keeps
   reviewer identity out of anything a controller ever returns. */
const db = require('../../../db');

function findOne(reviewerEmployeeId, revieweeEmployeeId, quarter) {
  return db.prepare(`
    SELECT * FROM kpi_peer_review_responses
    WHERE reviewer_employee_id = ? AND reviewee_employee_id = ? AND quarter = ?
  `).get(reviewerEmployeeId, revieweeEmployeeId, quarter);
}

// Every response for one reviewee this quarter — the raw material
// kpiPeerReviewService averages into the public aggregate. Never returned
// directly from a controller.
function findByReviewee(revieweeEmployeeId, quarter) {
  return db.prepare(`
    SELECT * FROM kpi_peer_review_responses
    WHERE reviewee_employee_id = ? AND quarter = ?
  `).all(revieweeEmployeeId, quarter);
}

// Which reviewee ids this reviewer has already submitted for this quarter
// — backs the "already reviewed" flag on the reviewer's own roster view.
function findRevieweeIdsByReviewer(reviewerEmployeeId, quarter) {
  return db.prepare(`
    SELECT reviewee_employee_id FROM kpi_peer_review_responses
    WHERE reviewer_employee_id = ? AND quarter = ?
  `).all(reviewerEmployeeId, quarter).map((r) => r.reviewee_employee_id);
}

// Distinct reviewer count per reviewee this quarter — completion tracking
// for P&C (counts only, never content — see kpiPeerReviewService).
function countReviewersByReviewee(quarter) {
  return db.prepare(`
    SELECT reviewee_employee_id, COUNT(*) AS n
    FROM kpi_peer_review_responses
    WHERE quarter = ?
    GROUP BY reviewee_employee_id
  `).all(quarter);
}

function upsert({ reviewerEmployeeId, revieweeEmployeeId, quarter, workedWith, communication, collaboration, reliability, attitude, contribution, growth, comment }) {
  db.prepare(`
    INSERT INTO kpi_peer_review_responses
      (reviewer_employee_id, reviewee_employee_id, quarter, worked_with, communication, collaboration, reliability, attitude, contribution, growth, comment)
    VALUES (@reviewerEmployeeId, @revieweeEmployeeId, @quarter, @workedWith, @communication, @collaboration, @reliability, @attitude, @contribution, @growth, @comment)
    ON CONFLICT(reviewer_employee_id, reviewee_employee_id, quarter) DO UPDATE SET
      worked_with = excluded.worked_with,
      communication = excluded.communication,
      collaboration = excluded.collaboration,
      reliability = excluded.reliability,
      attitude = excluded.attitude,
      contribution = excluded.contribution,
      growth = excluded.growth,
      comment = excluded.comment,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    reviewerEmployeeId, revieweeEmployeeId, quarter,
    workedWith: workedWith ? 1 : 0,
    communication: workedWith ? communication ?? null : null,
    collaboration: workedWith ? collaboration ?? null : null,
    reliability: workedWith ? reliability ?? null : null,
    attitude: workedWith ? attitude ?? null : null,
    contribution: workedWith ? contribution ?? null : null,
    growth: workedWith ? growth ?? null : null,
    comment: comment || null,
  });
  return findOne(reviewerEmployeeId, revieweeEmployeeId, quarter);
}

module.exports = { findOne, findByReviewee, findRevieweeIdsByReviewer, countReviewersByReviewee, upsert };
