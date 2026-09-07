/* kpi_self_evaluations — the employee's own rating of themselves, one row
   per (employee, quarter). Only SQL here. */
const db = require('../../../db');

function findByEmployeeAndQuarter(employeeId, quarter) {
  return db.prepare('SELECT * FROM kpi_self_evaluations WHERE employee_id = ? AND quarter = ?').get(employeeId, quarter);
}

function existsForQuarter(employeeId, quarter) {
  return !!findByEmployeeAndQuarter(employeeId, quarter);
}

function upsert({ employeeId, quarter, communication, collaboration, reliability, attitude, contribution, growth, comment }) {
  db.prepare(`
    INSERT INTO kpi_self_evaluations
      (employee_id, quarter, communication, collaboration, reliability, attitude, contribution, growth, comment)
    VALUES (@employeeId, @quarter, @communication, @collaboration, @reliability, @attitude, @contribution, @growth, @comment)
    ON CONFLICT(employee_id, quarter) DO UPDATE SET
      communication = excluded.communication,
      collaboration = excluded.collaboration,
      reliability = excluded.reliability,
      attitude = excluded.attitude,
      contribution = excluded.contribution,
      growth = excluded.growth,
      comment = excluded.comment,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    employeeId, quarter,
    communication: communication ?? null,
    collaboration: collaboration ?? null,
    reliability: reliability ?? null,
    attitude: attitude ?? null,
    contribution: contribution ?? null,
    growth: growth ?? null,
    comment: comment || null,
  });
  return findByEmployeeAndQuarter(employeeId, quarter);
}

module.exports = { findByEmployeeAndQuarter, existsForQuarter, upsert };
