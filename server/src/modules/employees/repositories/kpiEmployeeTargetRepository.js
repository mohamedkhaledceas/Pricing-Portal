/* kpi_employee_targets — one row per (employee, quarter, metric) override.
   Only SQL here. */
const db = require('../../../db');

function findByEmployeeAndQuarter(employeeId, quarter) {
  return db.prepare('SELECT * FROM kpi_employee_targets WHERE employee_id = ? AND quarter = ?').all(employeeId, quarter);
}

function findOne(employeeId, quarter, metricId) {
  return db.prepare('SELECT * FROM kpi_employee_targets WHERE employee_id = ? AND quarter = ? AND metric_id = ?').get(employeeId, quarter, metricId);
}

function upsert({ employeeId, quarter, metricId, targetValue, setBy }) {
  db.prepare(`
    INSERT INTO kpi_employee_targets (employee_id, quarter, metric_id, target_value, set_by)
    VALUES (@employeeId, @quarter, @metricId, @targetValue, @setBy)
    ON CONFLICT(employee_id, quarter, metric_id) DO UPDATE SET
      target_value = excluded.target_value,
      set_by = excluded.set_by,
      updated_at = CURRENT_TIMESTAMP
  `).run({ employeeId, quarter, metricId, targetValue, setBy });
  return findOne(employeeId, quarter, metricId);
}

module.exports = { findByEmployeeAndQuarter, findOne, upsert };
