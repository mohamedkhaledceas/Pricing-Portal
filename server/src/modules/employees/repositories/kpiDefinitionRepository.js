/* kpi_definitions — the Pillar B framework, transcribed from
   KPI_Framework.xlsx (see kpiFrameworkSeed.data.js). Only SQL here. */
const db = require('../../../db');

function findByProfileAndQuarter(kpiProfile, quarter) {
  return db
    .prepare('SELECT * FROM kpi_definitions WHERE kpi_profile = ? AND effective_quarter = ? ORDER BY pillar, metric_id')
    .all(kpiProfile, quarter);
}

function existsForQuarter(quarter) {
  return !!db.prepare('SELECT id FROM kpi_definitions WHERE effective_quarter = ? LIMIT 1').get(quarter);
}

// Every quarter the framework has been seeded for, newest first — the
// source of truth for the quarter picker (item: dropdown, not free text).
function listDistinctQuarters() {
  return db.prepare('SELECT DISTINCT effective_quarter FROM kpi_definitions ORDER BY effective_quarter DESC')
    .all()
    .map((row) => row.effective_quarter);
}

/* Idempotent bulk seed — INSERT ... ON CONFLICT DO UPDATE against the
   UNIQUE(kpi_profile, metric_id, effective_quarter) constraint, so calling
   this every server boot never duplicates rows AND a correction made in
   kpiFrameworkSeed.data.js (a fixed weight, a changed formula_config) self-
   heals on next boot instead of being silently stuck at whatever was first
   ever seeded for that quarter. A kpi_scores row already entered against
   the old formula keeps its own already-computed_score (a score is a
   snapshot at entry time, never retroactively recalculated) — only the
   definition itself, and any future score computed against it, changes. */
function seedMany(rows) {
  const insert = db.prepare(`
    INSERT INTO kpi_definitions
      (kpi_profile, pillar, metric_id, name, weight_pct, target_text, source_type, formula_config, effective_quarter)
    VALUES (@kpiProfile, @pillar, @metricId, @name, @weightPct, @targetText, @sourceType, @formulaConfig, @effectiveQuarter)
    ON CONFLICT(kpi_profile, metric_id, effective_quarter) DO UPDATE SET
      pillar = excluded.pillar,
      name = excluded.name,
      weight_pct = excluded.weight_pct,
      target_text = excluded.target_text,
      source_type = excluded.source_type,
      formula_config = excluded.formula_config
  `);
  const tx = db.transaction((defs) => {
    for (const row of defs) {
      insert.run({ ...row, formulaConfig: JSON.stringify(row.formulaConfig) });
    }
  });
  tx(rows);
}

module.exports = { findByProfileAndQuarter, existsForQuarter, listDistinctQuarters, seedMany };
