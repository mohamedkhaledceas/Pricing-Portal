/* Team reviews — only SQL here. Two tables that are never joined
   (migration 046): kpi_peer_review_submissions knows who has submitted for
   whom, kpi_peer_review_answers holds what was said, with no reviewer.
   Nothing in this file can link the two. */
const crypto = require('crypto');
const db = require('../../../db');

function hasSubmitted(reviewerEmployeeId, revieweeEmployeeId, quarter) {
  return !!db.prepare(`
    SELECT 1 FROM kpi_peer_review_submissions
    WHERE reviewer_employee_id = ? AND reviewee_employee_id = ? AND quarter = ?
  `).get(reviewerEmployeeId, revieweeEmployeeId, quarter);
}

// Which reviewee ids this reviewer has already submitted for this quarter
// — the "already reviewed" flag on their own roster, and completion counts.
function findRevieweeIdsByReviewer(reviewerEmployeeId, quarter) {
  return db.prepare(`
    SELECT reviewee_employee_id FROM kpi_peer_review_submissions
    WHERE reviewer_employee_id = ? AND quarter = ?
  `).all(reviewerEmployeeId, quarter).map((r) => r.reviewee_employee_id);
}

// Throws SQLite's UNIQUE error on a second submission for the same pair —
// the service turns that into "already submitted".
function insertSubmission({ reviewerEmployeeId, revieweeEmployeeId, quarter }) {
  return db.prepare(`
    INSERT INTO kpi_peer_review_submissions (reviewer_employee_id, reviewee_employee_id, quarter)
    VALUES (?, ?, ?)
  `).run(reviewerEmployeeId, revieweeEmployeeId, quarter).lastInsertRowid;
}

function insertAnswer({ revieweeEmployeeId, quarter, workedWith, communication, collaboration, reliability, attitude, contribution, growth, comment }) {
  db.prepare(`
    INSERT INTO kpi_peer_review_answers
      (id, reviewee_employee_id, quarter, worked_with, communication, collaboration, reliability, attitude, contribution, growth, comment)
    VALUES (@id, @revieweeEmployeeId, @quarter, @workedWith, @communication, @collaboration, @reliability, @attitude, @contribution, @growth, @comment)
  `).run({
    id: crypto.randomBytes(16).toString('hex'),
    revieweeEmployeeId,
    quarter,
    workedWith: workedWith ? 1 : 0,
    communication: workedWith ? communication ?? null : null,
    collaboration: workedWith ? collaboration ?? null : null,
    reliability: workedWith ? reliability ?? null : null,
    attitude: workedWith ? attitude ?? null : null,
    contribution: workedWith ? contribution ?? null : null,
    growth: workedWith ? growth ?? null : null,
    comment: comment || null,
  });
}

// Every answer about one reviewee this quarter, in random-id order — the
// raw material the service averages. Never returned from a controller.
function findAnswersByReviewee(revieweeEmployeeId, quarter) {
  return db.prepare(`
    SELECT * FROM kpi_peer_review_answers
    WHERE reviewee_employee_id = ? AND quarter = ?
    ORDER BY id
  `).all(revieweeEmployeeId, quarter);
}

module.exports = {
  hasSubmitted, findRevieweeIdsByReviewer, insertSubmission, insertAnswer, findAnswersByReviewee,
};
