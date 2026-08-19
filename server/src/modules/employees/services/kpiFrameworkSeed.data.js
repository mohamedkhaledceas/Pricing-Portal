/* Transcription of KPI_Framework.xlsx (Q2 2026, "Option B Growth weights")
   into kpi_definitions rows — the source of truth for every number below
   is that spreadsheet, not this file; if the two ever disagree, the
   spreadsheet wins and this needs updating, not the other way around.

   formula_config shapes (interpreted by kpiScoringService):
     { kind: 'bands', bands: [{ min?, max?, score }] }
       First matching band wins (min/max inclusive; missing min/max means
       unbounded on that side). Covers revision-round counts, percentage
       bands, and stepped count targets — the large majority of metrics.
     { kind: 'binary' }
       actual truthy ("met"/"yes"/true/1) -> 100, else 0. No partial credit.
     { kind: 'ratio', target }
       score = min(100, (actual / target) * 100). "Count÷target×weight"
       metrics.
     { kind: 'deduction', base, perViolationPct }
       score = max(0, base - perViolationPct * actualViolationCount).
       "100%=100%, each missed=-N%" metrics — actual_value is a violation
       count, not the raw percentage.

   Pillar A (60%, all roles, equally weighted across 6 dimensions — see
   kpiScoringService) has no rows here by design: it's fixed and identical
   for every role, unlike Pillar B's genuinely role-specific metrics. */

const QUARTER = '2026-Q2';

function bands(list) {
  return { kind: 'bands', bands: list };
}
function binary() {
  return { kind: 'binary' };
}
function ratio(target) {
  return { kind: 'ratio', target };
}
function deduction(base, perViolationPct) {
  return { kind: 'deduction', base, perViolationPct };
}
// For the handful of metrics whose target genuinely varies per person
// (Production's D1/D4 — see target_text) and can't be expressed as one
// formula: whoever enters the score compares the actual against that
// person's own target and enters the resulting 0–100 score directly,
// rather than kpiScoringService computing it from a raw actual value.
function manualScore() {
  return { kind: 'manual_score' };
}

const GROWTH_TEMPLATE = (skillLabel, tkLabel) => [
  { pillar: 'growth', metricId: 'G1', name: 'Last Q goal ★', weightPct: 5, targetText: 'Carry-forward from Q before', sourceType: 'goals', formulaConfig: binary() },
  { pillar: 'growth', metricId: 'G2', name: skillLabel || 'Skill / learning logged', weightPct: 3, targetText: '1 per quarter', sourceType: 'goals', formulaConfig: binary() },
  { pillar: 'growth', metricId: 'G3', name: tkLabel, weightPct: 2, targetText: '1 per quarter', sourceType: 'goals', formulaConfig: binary() },
];

const DEFINITIONS = [
  // ---- Content Creators ----
  { kpiProfile: 'content', pillar: 'quality', metricId: 'Q1', name: 'Client revision rounds on copy/scripts', weightPct: 5, targetText: '≤2 rounds avg', sourceType: 'auto', formulaConfig: bands([{ max: 2, score: 100 }, { min: 2.001, max: 3, score: 50 }, { min: 3.001, score: 0 }]) },
  { kpiProfile: 'content', pillar: 'quality', metricId: 'Q2', name: 'Content rejection rate (quality issues only)', weightPct: 5, targetText: '<8%', sourceType: 'semi', formulaConfig: bands([{ max: 7.999, score: 100 }, { min: 8, max: 15, score: 50 }, { min: 15.001, score: 0 }]) },
  { kpiProfile: 'content', pillar: 'quality', metricId: 'Q3', name: 'Internal revision rounds (QC loop)', weightPct: 5, targetText: '≤1 avg', sourceType: 'auto', formulaConfig: bands([{ max: 1, score: 100 }, { min: 1.001, max: 2, score: 70 }, { min: 2.001, score: 40 }]) },
  { kpiProfile: 'content', pillar: 'delivery', metricId: 'D1', name: 'Campaigns produced', weightPct: 4, targetText: '1–2 / quarter', sourceType: 'auto', formulaConfig: ratio(1.5) },
  { kpiProfile: 'content', pillar: 'delivery', metricId: 'D2', name: 'Pitches delivered', weightPct: 3, targetText: '1 / quarter', sourceType: 'auto', formulaConfig: binary() },
  { kpiProfile: 'content', pillar: 'delivery', metricId: 'D3', name: 'Strategy direction delivered', weightPct: 4, targetText: '1 / quarter', sourceType: 'auto', formulaConfig: binary() },
  { kpiProfile: 'content', pillar: 'delivery', metricId: 'D4', name: 'On-time completion rate', weightPct: 4, targetText: '≥95%', sourceType: 'auto', formulaConfig: bands([{ min: 95, score: 100 }, { min: 85, max: 94.999, score: 70 }, { min: 75, max: 84.999, score: 40 }, { max: 74.999, score: 0 }]) },
  ...GROWTH_TEMPLATE(null, 'TK report delivered').map((r) => ({ kpiProfile: 'content', ...r })),

  // ---- Art Director (Noura) ----
  { kpiProfile: 'artdirector', pillar: 'quality', metricId: 'Q1', name: 'Design QC reviews completed (weekly)', weightPct: 5, targetText: '12/quarter (1/week)', sourceType: 'auto', formulaConfig: bands([{ min: 12, score: 100 }, { min: 10, max: 11, score: 70 }, { max: 9.999, score: 40 }]) },
  { kpiProfile: 'artdirector', pillar: 'quality', metricId: 'Q2', name: 'Art direction revision rounds (client)', weightPct: 5, targetText: '≤2 per AD task', sourceType: 'auto', formulaConfig: bands([{ max: 2, score: 100 }, { min: 2.001, max: 3, score: 50 }, { min: 3.001, score: 0 }]) },
  { kpiProfile: 'artdirector', pillar: 'quality', metricId: 'Q3', name: 'Branding project rejection rate', weightPct: 5, targetText: '<8%', sourceType: 'semi', formulaConfig: bands([{ max: 7.999, score: 100 }, { min: 8, max: 15, score: 50 }, { min: 15.001, score: 0 }]) },
  { kpiProfile: 'artdirector', pillar: 'delivery', metricId: 'D1', name: 'Art directions delivered', weightPct: 5, targetText: '3–4 / quarter', sourceType: 'auto', formulaConfig: ratio(4) },
  { kpiProfile: 'artdirector', pillar: 'delivery', metricId: 'D2', name: 'Branding projects completed', weightPct: 4, targetText: '2 / quarter', sourceType: 'auto', formulaConfig: bands([{ min: 2, score: 100 }, { min: 1, max: 1.999, score: 50 }, { max: 0.999, score: 0 }]) },
  { kpiProfile: 'artdirector', pillar: 'delivery', metricId: 'D3', name: 'Campaign art direction delivered', weightPct: 3, targetText: '1 / quarter', sourceType: 'auto', formulaConfig: binary() },
  { kpiProfile: 'artdirector', pillar: 'delivery', metricId: 'D4', name: 'On-time completion rate', weightPct: 3, targetText: '≥95%', sourceType: 'auto', formulaConfig: bands([{ min: 95, score: 100 }, { min: 85, max: 94.999, score: 70 }, { max: 84.999, score: 0 }]) },
  ...GROWTH_TEMPLATE(null, 'Visual TK delivered').map((r) => ({ kpiProfile: 'artdirector', ...r })),

  // ---- AI Designer (Nada) ----
  { kpiProfile: 'aidesigner', pillar: 'quality', metricId: 'Q1', name: 'Design revision rounds (client)', weightPct: 5, targetText: '≤2 per task', sourceType: 'auto', formulaConfig: bands([{ max: 2, score: 100 }, { min: 2.001, max: 3, score: 50 }, { min: 3.001, score: 0 }]) },
  { kpiProfile: 'aidesigner', pillar: 'quality', metricId: 'Q2', name: 'Design rejection rate (quality issues)', weightPct: 5, targetText: '<8%', sourceType: 'semi', formulaConfig: bands([{ max: 7.999, score: 100 }, { min: 8, max: 15, score: 50 }, { min: 15.001, score: 0 }]) },
  { kpiProfile: 'aidesigner', pillar: 'quality', metricId: 'Q3', name: 'QC pass rate — Noura review (first attempt)', weightPct: 5, targetText: '≥90%', sourceType: 'auto', formulaConfig: bands([{ min: 90, score: 100 }, { min: 80, max: 89.999, score: 70 }, { max: 79.999, score: 40 }]) },
  { kpiProfile: 'aidesigner', pillar: 'delivery', metricId: 'D1', name: 'Presentations designed', weightPct: 4, targetText: '3 / quarter', sourceType: 'auto', formulaConfig: bands([{ min: 3, score: 100 }, { min: 2, max: 2.999, score: 70 }, { min: 1, max: 1.999, score: 30 }, { max: 0.999, score: 0 }]) },
  { kpiProfile: 'aidesigner', pillar: 'delivery', metricId: 'D2', name: 'AI project delivered', weightPct: 4, targetText: '1 / quarter', sourceType: 'auto', formulaConfig: binary() },
  { kpiProfile: 'aidesigner', pillar: 'delivery', metricId: 'D3', name: 'Campaign asset set delivered', weightPct: 4, targetText: '1 / quarter', sourceType: 'auto', formulaConfig: binary() },
  { kpiProfile: 'aidesigner', pillar: 'delivery', metricId: 'D4', name: 'On-time completion rate', weightPct: 3, targetText: '≥95%', sourceType: 'auto', formulaConfig: bands([{ min: 95, score: 100 }, { min: 85, max: 94.999, score: 70 }, { max: 84.999, score: 0 }]) },
  ...GROWTH_TEMPLATE(null, 'AI / Design TK delivered').map((r) => ({ kpiProfile: 'aidesigner', ...r })),

  // ---- Production Team (Omar · Kareem · Rodaina) ----
  { kpiProfile: 'production', pillar: 'quality', metricId: 'Q1', name: 'Client revision rounds per reel', weightPct: 5, targetText: '≤2 / reel avg', sourceType: 'auto', formulaConfig: bands([{ max: 2, score: 100 }, { min: 2.001, max: 3, score: 50 }, { min: 3.001, score: 0 }]) },
  { kpiProfile: 'production', pillar: 'quality', metricId: 'Q2', name: 'Quality rejection rate', weightPct: 5, targetText: '<8%', sourceType: 'semi', formulaConfig: bands([{ max: 7.999, score: 100 }, { min: 8, max: 15, score: 50 }, { min: 15.001, score: 0 }]) },
  { kpiProfile: 'production', pillar: 'quality', metricId: 'Q3', name: 'Internal revision rounds (QC + Internal loops)', weightPct: 5, targetText: '≤1 avg', sourceType: 'auto', formulaConfig: bands([{ max: 1, score: 100 }, { min: 1.001, max: 2, score: 70 }, { min: 2.001, score: 40 }]) },
  { kpiProfile: 'production', pillar: 'delivery', metricId: 'D1', name: 'Reels / videos delivered (Scheduled)', weightPct: 5, targetText: 'Per-person target: Omar 30–40/mo · Kareem 15–20/mo · Rodaina UGC count/Q', sourceType: 'auto', formulaConfig: manualScore() },
  { kpiProfile: 'production', pillar: 'delivery', metricId: 'D2', name: 'On-time completion rate', weightPct: 4, targetText: '≥95%', sourceType: 'auto', formulaConfig: bands([{ min: 95, score: 100 }, { min: 85, max: 94.999, score: 70 }, { max: 84.999, score: 0 }]) },
  { kpiProfile: 'production', pillar: 'delivery', metricId: 'D3', name: 'ClickUp updated + response time', weightPct: 3, targetText: '≥95% updated · ≤15 min response avg', sourceType: 'auto', formulaConfig: bands([{ min: 2, score: 100 }, { min: 1, max: 1.999, score: 50 }, { max: 0.999, score: 0 }]) },
  { kpiProfile: 'production', pillar: 'delivery', metricId: 'D4', name: 'Quarterly role deliverables met', weightPct: 3, targetText: 'Per-person target (see role-specific list)', sourceType: 'auto', formulaConfig: manualScore() },
  ...GROWTH_TEMPLATE(null, 'AI project or SOP/framework delivered').map((r) => ({ kpiProfile: 'production', ...r })),

  // ---- Account Manager (AM) ----
  { kpiProfile: 'am', pillar: 'quality', metricId: 'Q1', name: 'Brief accuracy & completeness', weightPct: 5, targetText: '100% of clients', sourceType: 'auto', formulaConfig: deduction(100, 10) },
  { kpiProfile: 'am', pillar: 'quality', metricId: 'Q2', name: 'Client submission turnaround time', weightPct: 5, targetText: '≤48h avg', sourceType: 'auto', formulaConfig: bands([{ max: 48, score: 100 }, { min: 48.001, max: 72, score: 70 }, { min: 72.001, score: 30 }]) },
  { kpiProfile: 'am', pillar: 'quality', metricId: 'Q3', name: 'Internal review pass rate', weightPct: 3, targetText: '≥85% first pass', sourceType: 'auto', formulaConfig: bands([{ min: 85, score: 100 }, { min: 80, max: 84.999, score: 70 }, { max: 79.999, score: 40 }]) },
  { kpiProfile: 'am', pillar: 'quality', metricId: 'Q4', name: 'Client satisfaction check-in done', weightPct: 2, targetText: 'Monthly per client', sourceType: 'semi', formulaConfig: deduction(100, 33) },
  { kpiProfile: 'am', pillar: 'delivery', metricId: 'D1', name: 'Active retainers managed', weightPct: 4, targetText: '18–20 clients', sourceType: 'auto', formulaConfig: bands([{ min: 18, max: 20, score: 100 }, { min: 15, max: 17.999, score: 80 }, { max: 14.999, score: 50 }]) },
  { kpiProfile: 'am', pillar: 'delivery', metricId: 'D2', name: 'Invoices issued on time', weightPct: 4, targetText: '≥90%', sourceType: 'odoo', formulaConfig: bands([{ min: 90, score: 100 }, { min: 80, max: 89.999, score: 70 }, { max: 79.999, score: 0 }]) },
  { kpiProfile: 'am', pillar: 'delivery', metricId: 'D3', name: 'Invoice collection rate', weightPct: 3, targetText: '≥80%', sourceType: 'odoo', formulaConfig: bands([{ min: 80, score: 100 }, { min: 70, max: 79.999, score: 60 }, { max: 69.999, score: 0 }]) },
  { kpiProfile: 'am', pillar: 'delivery', metricId: 'D4', name: 'Kickoffs within 48h of payment', weightPct: 2, targetText: '100%', sourceType: 'auto', formulaConfig: deduction(100, 15) },
  { kpiProfile: 'am', pillar: 'delivery', metricId: 'D5', name: 'Monthly calendar brief submitted', weightPct: 2, targetText: 'Every month per client', sourceType: 'auto', formulaConfig: deduction(100, 8) },
  ...GROWTH_TEMPLATE(null, 'Proactive client initiative delivered').map((r) => ({ kpiProfile: 'am', ...r })),

  // ---- People & Culture (P&C) ----
  // Growth section deliberately dropped — People & Retention replaces it
  // per the sheet's own header note (decision: Pillar B = 15+15+10 = 40,
  // matching every other role, not the 50 a literal reading would give).
  { kpiProfile: 'pandc', pillar: 'quality', metricId: 'Q1', name: 'Time to fill (approved role → sourcing starts)', weightPct: 5, targetText: '≤21 days', sourceType: 'auto', formulaConfig: bands([{ max: 21, score: 100 }, { min: 22, max: 30, score: 70 }, { min: 31, max: 45, score: 40 }, { min: 46, score: 0 }]) },
  { kpiProfile: 'pandc', pillar: 'quality', metricId: 'Q2', name: 'Time to hire (request → complete/hired)', weightPct: 5, targetText: '≤30 days', sourceType: 'auto', formulaConfig: bands([{ max: 30, score: 100 }, { min: 31, max: 45, score: 70 }, { min: 46, max: 60, score: 40 }, { min: 61, score: 0 }]) },
  { kpiProfile: 'pandc', pillar: 'quality', metricId: 'Q3', name: 'Onboarding completion rate', weightPct: 5, targetText: '100% per hire', sourceType: 'auto', formulaConfig: deduction(100, 15) },
  { kpiProfile: 'pandc', pillar: 'delivery', metricId: 'D1', name: 'TK sessions delivered', weightPct: 5, targetText: '≥4 / quarter', sourceType: 'auto', formulaConfig: bands([{ min: 4, score: 100 }, { min: 3, max: 3.999, score: 75 }, { min: 2, max: 2.999, score: 50 }, { min: 1, max: 1.999, score: 25 }, { max: 0.999, score: 0 }]) },
  { kpiProfile: 'pandc', pillar: 'delivery', metricId: 'D2', name: 'Time off & WFH processed on time', weightPct: 5, targetText: '100% within 24h', sourceType: 'auto', formulaConfig: deduction(100, 10) },
  { kpiProfile: 'pandc', pillar: 'delivery', metricId: 'D3', name: 'P&C task completion rate', weightPct: 5, targetText: '≥85% per quarter', sourceType: 'auto', formulaConfig: bands([{ min: 85, score: 100 }, { min: 75, max: 84.999, score: 70 }, { min: 65, max: 74.999, score: 40 }, { max: 64.999, score: 0 }]) },
  { kpiProfile: 'pandc', pillar: 'people_retention', metricId: 'P1', name: 'Employee engagement rate', weightPct: 3, targetText: '≥80 score', sourceType: 'semi', formulaConfig: bands([{ min: 80, score: 100 }, { min: 70, max: 79.999, score: 70 }, { min: 60, max: 69.999, score: 40 }, { max: 59.999, score: 0 }]) },
  { kpiProfile: 'pandc', pillar: 'people_retention', metricId: 'P2', name: 'Employee satisfaction rate', weightPct: 3, targetText: '≥80 score', sourceType: 'semi', formulaConfig: bands([{ min: 80, score: 100 }, { min: 70, max: 79.999, score: 70 }, { min: 60, max: 69.999, score: 40 }, { max: 59.999, score: 0 }]) },
  { kpiProfile: 'pandc', pillar: 'people_retention', metricId: 'P3', name: 'Employee retention rate (Odoo)', weightPct: 4, targetText: '≤10% turnover', sourceType: 'odoo', formulaConfig: bands([{ max: 10, score: 100 }, { min: 10.001, max: 15, score: 70 }, { min: 15.001, score: 0 }]) },
];

module.exports = DEFINITIONS.map((row) => ({ ...row, effectiveQuarter: QUARTER }));
