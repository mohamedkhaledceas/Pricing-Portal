/* kpi_pillar_a_reviews — aggregated (anonymous) Google Form results, one
   row per (employee, quarter). No per-reviewer identity is ever stored —
   see the migration's comment for why. Only SQL here. */
const db = require('../../../db');

function findByEmployeeAndQuarter(employeeId, quarter) {
  return db.prepare('SELECT * FROM kpi_pillar_a_reviews WHERE employee_id = ? AND quarter = ?').get(employeeId, quarter);
}

function upsert({ employeeId, quarter, communication, collaboration, reliability, attitude, contribution, growth, responseCount, feedback, enteredBy }) {
  db.prepare(`
    INSERT INTO kpi_pillar_a_reviews
      (employee_id, quarter, communication, collaboration, reliability, attitude, contribution, growth, response_count, feedback_json, entered_by, entered_at)
    VALUES (@employeeId, @quarter, @communication, @collaboration, @reliability, @attitude, @contribution, @growth, @responseCount, @feedbackJson, @enteredBy, CURRENT_TIMESTAMP)
    ON CONFLICT(employee_id, quarter) DO UPDATE SET
      communication = excluded.communication,
      collaboration = excluded.collaboration,
      reliability = excluded.reliability,
      attitude = excluded.attitude,
      contribution = excluded.contribution,
      growth = excluded.growth,
      response_count = excluded.response_count,
      feedback_json = excluded.feedback_json,
      entered_by = excluded.entered_by,
      entered_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    employeeId,
    quarter,
    communication,
    collaboration,
    reliability,
    attitude,
    contribution,
    growth,
    responseCount,
    feedbackJson: JSON.stringify(feedback || []),
    enteredBy,
  });
  return findByEmployeeAndQuarter(employeeId, quarter);
}

module.exports = { findByEmployeeAndQuarter, upsert };
