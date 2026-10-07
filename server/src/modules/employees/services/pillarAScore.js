/* Pillar A out of 60 from one kpi_pillar_a_reviews row: the average of the
   dimensions that were answered × 6 (KPI_Framework.xlsx "average × 6").
   Growth stopped being asked on 2026-09-28, so newer quarters average five
   — a plain sum would cap a perfect review at 50 (user decision
   2026-10-07). Shared by the KPI breakdown and the team review results so
   the two can never disagree. Pure. */
const PILLAR_A_KEYS = ['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'];
const PILLAR_A_MAX = 60;

function pillarAScore(row) {
  const answered = PILLAR_A_KEYS.map((k) => (row ? row[k] : null)).filter((v) => v !== null && v !== undefined).map(Number);
  if (answered.length === 0) return null;
  return (answered.reduce((s, v) => s + v, 0) / answered.length) * (PILLAR_A_MAX / 10);
}

module.exports = { pillarAScore, PILLAR_A_MAX };
