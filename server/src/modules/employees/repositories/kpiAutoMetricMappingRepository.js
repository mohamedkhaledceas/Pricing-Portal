/* kpi_auto_metric_mappings — only SQL here. config_json parsed/stringified
   at this layer so callers deal in plain objects. */
const db = require('../../../db');

function rowToMapping(row) {
  if (!row) return null;
  return { ...row, config: JSON.parse(row.config_json), active: !!row.active };
}

function findAllActive() {
  return db.prepare('SELECT * FROM kpi_auto_metric_mappings WHERE active = 1').all().map(rowToMapping);
}

function findAll() {
  return db.prepare('SELECT * FROM kpi_auto_metric_mappings ORDER BY kpi_profile, metric_id').all().map(rowToMapping);
}

function findOne(kpiProfile, metricId) {
  return rowToMapping(db.prepare('SELECT * FROM kpi_auto_metric_mappings WHERE kpi_profile = ? AND metric_id = ?').get(kpiProfile, metricId));
}

function upsert({ kpiProfile, metricId, method, config, active, createdBy }) {
  db.prepare(`
    INSERT INTO kpi_auto_metric_mappings (kpi_profile, metric_id, method, config_json, active, created_by)
    VALUES (@kpiProfile, @metricId, @method, @configJson, @active, @createdBy)
    ON CONFLICT(kpi_profile, metric_id) DO UPDATE SET
      method = excluded.method,
      config_json = excluded.config_json,
      active = excluded.active,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    kpiProfile, metricId, method,
    configJson: JSON.stringify(config || {}),
    active: active === false ? 0 : 1,
    createdBy,
  });
  return findOne(kpiProfile, metricId);
}

function remove(kpiProfile, metricId) {
  db.prepare('DELETE FROM kpi_auto_metric_mappings WHERE kpi_profile = ? AND metric_id = ?').run(kpiProfile, metricId);
}

module.exports = { findAllActive, findAll, findOne, upsert, remove };
