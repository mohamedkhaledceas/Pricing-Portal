const { EmployeesError } = require('../errors');

/* Pillar A's 6 dimensions (docs: KPI_Framework.xlsx "Overview" sheet) are
   fixed and identical for every role — equally weighted, each scored 0–10,
   summed directly for the Pillar A total (out of 60). This is the same
   arithmetic as the sheet's own "average × 6" description: avg(6 scores)×6
   is algebraically identical to just summing the 6 scores, so summing is
   what this does — no separate "average" step needed. */
const PILLAR_A_DIMENSIONS = [
  { key: 'communication', label: 'Communication' },
  { key: 'collaboration', label: 'Collaboration' },
  { key: 'reliability', label: 'Reliability' },
  { key: 'attitude', label: 'Attitude' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'growth', label: 'Growth' },
];

const PILLAR_A_WEIGHT_PCT = 60;
const PILLAR_B_WEIGHT_PCT = 40;

/* Interprets one kpi_definitions.formula_config against an actual_value —
   see kpiFrameworkSeed.data.js for what each `kind` means. Returns a score
   floored at 0 but with no upper ceiling — overperformance (e.g. a ratio
   metric where actual exceeds target, or a manually-entered growth score)
   is meant to score above 100 and pull the weighted total up accordingly,
   not get clipped back down to the target. Returns null if there's no
   actual value to score yet (an unentered metric shows its target/formula
   on the audit page, just no score). */
function computeMetricScore(formulaConfig, actualValue) {
  if (actualValue === null || actualValue === undefined || actualValue === '') return null;

  if (formulaConfig.kind === 'manual_score') {
    const n = Number(actualValue);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  }

  if (formulaConfig.kind === 'binary') {
    const truthy = ['met', 'yes', 'true', '1', 1, true].includes(
      typeof actualValue === 'string' ? actualValue.toLowerCase() : actualValue
    );
    return truthy ? 100 : 0;
  }

  if (formulaConfig.kind === 'ratio') {
    const n = Number(actualValue);
    if (!Number.isFinite(n) || !formulaConfig.target) return null;
    return Math.max(0, (n / formulaConfig.target) * 100);
  }

  if (formulaConfig.kind === 'deduction') {
    const violations = Number(actualValue);
    if (!Number.isFinite(violations)) return null;
    return Math.max(0, formulaConfig.base - formulaConfig.perViolationPct * violations);
  }

  if (formulaConfig.kind === 'bands') {
    const n = Number(actualValue);
    if (!Number.isFinite(n)) return null;
    for (const band of formulaConfig.bands) {
      const aboveMin = band.min === undefined || n >= band.min;
      const belowMax = band.max === undefined || n <= band.max;
      if (aboveMin && belowMax) return band.score;
    }
    return null;
  }

  return null;
}

function createKpiScoringService({ employeeRepository, kpiDefinitionRepository, kpiScoreRepository, pillarAReviewRepository }) {
  function buildPillarA(reviewRow) {
    const dimensions = PILLAR_A_DIMENSIONS.map((dim) => {
      const raw = reviewRow ? reviewRow[dim.key] : null;
      const score = raw === null || raw === undefined ? null : Number(raw);
      return { key: dim.key, label: dim.label, score, weightedPoints: score };
    });
    const total = dimensions.reduce((sum, d) => sum + (d.score || 0), 0);
    return {
      dimensions,
      total,
      maxTotal: PILLAR_A_WEIGHT_PCT,
      responseCount: reviewRow ? reviewRow.response_count : 0,
      feedback: reviewRow ? JSON.parse(reviewRow.feedback_json || '[]') : [],
    };
  }

  function buildPillarB(definitions, scoresByMetric) {
    if (definitions.length === 0) {
      return { defined: false, metrics: [], total: 0, maxTotal: 0 };
    }
    const metrics = definitions.map((def) => {
      const scoreRow = scoresByMetric[def.metric_id];
      const formulaConfig = JSON.parse(def.formula_config);
      const actualValue = scoreRow ? scoreRow.actual_value : null;
      const score = scoreRow ? scoreRow.computed_score : computeMetricScore(formulaConfig, actualValue);
      const weightedPoints = score === null ? null : (score / 100) * def.weight_pct;
      return {
        metricId: def.metric_id,
        pillar: def.pillar,
        name: def.name,
        target: def.target_text,
        formulaConfig,
        sourceType: def.source_type,
        weightPct: def.weight_pct,
        actualValue,
        score,
        weightedPoints,
        enteredBy: scoreRow ? scoreRow.entered_by : null,
        enteredAt: scoreRow ? scoreRow.entered_at : null,
        scoreSource: scoreRow ? scoreRow.source : null,
      };
    });
    const total = metrics.reduce((sum, m) => sum + (m.weightedPoints || 0), 0);
    const maxTotal = definitions.reduce((sum, d) => sum + d.weight_pct, 0);
    return { defined: true, metrics, total, maxTotal };
  }

  /* The one calculation path — both the employee-facing dashboard and the
     KPI calculation/audit page call this and render different views of
     the same result, so there's no second calculator that could drift
     from the first. */
  function computeBreakdown(employeeId, quarter) {
    const employee = employeeRepository.findById(employeeId);
    if (!employee) throw new EmployeesError('Employee not found.', 404);

    const reviewRow = pillarAReviewRepository.findByEmployeeAndQuarter(employeeId, quarter);
    const pillarA = buildPillarA(reviewRow);

    const definitions = employee.kpi_profile
      ? kpiDefinitionRepository.findByProfileAndQuarter(employee.kpi_profile, quarter)
      : [];
    const scoreRows = kpiScoreRepository.findByEmployeeAndQuarter(employeeId, quarter);
    const scoresByMetric = {};
    for (const row of scoreRows) scoresByMetric[row.metric_id] = row;
    const pillarB = buildPillarB(definitions, scoresByMetric);

    const pillarAWeighted = pillarA.total; // already 0-60, no further scaling
    const pillarBWeighted = pillarB.total; // already 0-40 (or less if not fully entered)
    const finalScore = pillarAWeighted + pillarBWeighted;

    return {
      employeeId,
      quarter,
      kpiProfile: employee.kpi_profile,
      pillarA,
      pillarB,
      final: {
        pillarAWeighted,
        pillarAWeightPct: PILLAR_A_WEIGHT_PCT,
        pillarBWeighted,
        pillarBWeightPct: PILLAR_B_WEIGHT_PCT,
        total: finalScore,
      },
    };
  }

  /* The raw framework definition for a role — no employee/scores involved.
     Lets P&C visually check the transcription against KPI_Framework.xlsx
     before any real scores exist (the audit page's "view by role" mode). */
  function getFrameworkDefinition(kpiProfile, quarter) {
    const definitions = kpiDefinitionRepository.findByProfileAndQuarter(kpiProfile, quarter);
    return {
      kpiProfile,
      quarter,
      pillarA: {
        dimensions: PILLAR_A_DIMENSIONS,
        weightPct: PILLAR_A_WEIGHT_PCT,
        note: 'Equally weighted, 1–10 each, summed directly (algebraically identical to average × 6).',
      },
      pillarB:
        definitions.length === 0
          ? { defined: false, metrics: [] }
          : {
              defined: true,
              metrics: definitions.map((def) => ({
                metricId: def.metric_id,
                pillar: def.pillar,
                name: def.name,
                target: def.target_text,
                weightPct: def.weight_pct,
                sourceType: def.source_type,
                formulaConfig: JSON.parse(def.formula_config),
              })),
            },
    };
  }

  function enterManualScore({ employeeId, quarter, metricId, actualValue, actorEmployee, actorId, kpiProfile }) {
    const employee = employeeRepository.findById(employeeId);
    if (!employee) throw new EmployeesError('Employee not found.', 404);
    if (!actorEmployee || (!actorEmployee.isPeopleCulture && actorEmployee.id !== employee.manager_employee_id)) {
      throw new EmployeesError('You do not have permission to enter KPI scores for this employee.', 403);
    }
    const definitions = kpiDefinitionRepository.findByProfileAndQuarter(employee.kpi_profile, quarter);
    const definition = definitions.find((d) => d.metric_id === metricId);
    if (!definition) throw new EmployeesError('Unknown KPI metric for this role/quarter.', 404);

    const formulaConfig = JSON.parse(definition.formula_config);
    const score = computeMetricScore(formulaConfig, actualValue);
    if (score === null) throw new EmployeesError('Could not compute a score from that value.');

    return kpiScoreRepository.upsert({
      employeeId,
      quarter,
      metricId,
      actualValue,
      computedScore: score,
      enteredBy: actorEmployee.id,
      source: 'manual',
    });
  }

  return { computeMetricScore, computeBreakdown, getFrameworkDefinition, enterManualScore, PILLAR_A_DIMENSIONS };
}

module.exports = createKpiScoringService;
