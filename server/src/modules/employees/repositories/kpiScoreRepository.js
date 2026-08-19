/* kpi_scores — one row per (employee, quarter, metric). Only SQL here. */
const db = require('../../../db');

function findByEmployeeAndQuarter(employeeId, quarter) {
  return db.prepare('SELECT * FROM kpi_scores WHERE employee_id = ? AND quarter = ?').all(employeeId, quarter);
}

function upsert({ employeeId, quarter, metricId, actualValue, computedScore, enteredBy, source }) {
  db.prepare(`
    INSERT INTO kpi_scores (employee_id, quarter, metric_id, actual_value, computed_score, entered_by, entered_at, source)
    VALUES (@employeeId, @quarter, @metricId, @actualValue, @computedScore, @enteredBy, CURRENT_TIMESTAMP, @source)
    ON CONFLICT(employee_id, quarter, metric_id) DO UPDATE SET
      actual_value = excluded.actual_value,
      computed_score = excluded.computed_score,
      entered_by = excluded.entered_by,
      entered_at = excluded.entered_at,
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP
  `).run({ employeeId, quarter, metricId, actualValue: String(actualValue), computedScore, enteredBy, source });
  return db.prepare('SELECT * FROM kpi_scores WHERE employee_id = ? AND quarter = ? AND metric_id = ?').get(employeeId, quarter, metricId);
}

module.exports = { findByEmployeeAndQuarter, upsert };
