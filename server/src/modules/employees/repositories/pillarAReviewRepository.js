/* kpi_pillar_a_reviews — aggregated (anonymous) Google Form results, one
   row per (employee, quarter). No per-reviewer identity is ever stored —
   see the migration's comment for why. Only SQL here. */
const db = require('../../../db');

function findByEmployeeAndQuarter(employeeId, quarter) {
  return db.prepare('SELECT * FROM kpi_pillar_a_reviews WHERE employee_id = ? AND quarter = ?').get(employeeId, quarter);
}

// Distinct quarters this employee has a Pillar A review for — unioned with
// kpiScoreRepository.listQuartersWithData by the service layer to build the
// full Performance History quarter list (item 10).
function listQuartersWithData(employeeId) {
  return db.prepare('SELECT DISTINCT quarter FROM kpi_pillar_a_reviews WHERE employee_id = ? ORDER BY quarter DESC')
    .all(employeeId)
    .map((row) => row.quarter);
}

// Active employees with a kpi_profile assigned but no Pillar A review yet
// this quarter — backs Required Actions (item 12) for P&C.
function findMissingForQuarter(quarter) {
  return db.prepare(`
    SELECT e.id AS employee_id
    FROM employees e
    WHERE e.active = 1 AND e.kpi_profile IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM kpi_pillar_a_reviews r WHERE r.employee_id = e.id AND r.quarter = ?
      )
  `).all(quarter).map((row) => row.employee_id);
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

module.exports = { findByEmployeeAndQuarter, upsert, listQuartersWithData, findMissingForQuarter };
