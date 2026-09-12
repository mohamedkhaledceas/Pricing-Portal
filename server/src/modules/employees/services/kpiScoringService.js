const { EmployeesError } = require('../errors');
const { quarterCloseTimestampUtc } = require('../../../utils/cairoQuarter');

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

// Mirrors the kpi_profile CHECK constraint (migration 002) — validated
// here too so a bad mapping never gets past the service layer with a
// typo'd profile name.
const KPI_PROFILES = ['content', 'artdirector', 'aidesigner', 'production', 'am', 'pandc', 'heads', 'design'];

// The Overview sheet's own "SCORE BANDS" section, transcribed verbatim —
// the single source of truth for KPI status everywhere (overview,
// management view, team summary). Checked high-to-low; the last entry
// (min: -Infinity) always matches, so this never falls through.
const STATUS_BANDS = [
  { min: 90, key: 'exceptional', label: 'Exceptional' },
  { min: 80, key: 'strong', label: 'Strong' },
  { min: 70, key: 'on_track', label: 'On Track' },
  { min: 60, key: 'needs_improvement', label: 'Needs Improvement' },
  { min: -Infinity, key: 'at_risk', label: 'At Risk', note: 'Performance conversation required' },
];

function computeStatusBand(score) {
  const band = STATUS_BANDS.find((b) => score >= b.min);
  return { key: band.key, label: band.label, note: band.note || null };
}

/* Interprets one kpi_definitions.formula_config against an actual_value —
   see kpiFrameworkSeed.data.js for what each `kind` means. Returns a score
   floored at 0 but with no upper ceiling — overperformance (e.g. a ratio
   metric where actual exceeds target, or a manually-entered growth score)
   is meant to score above 100 and pull the weighted total up accordingly,
   not get clipped back down to the target. Returns null if there's no
   actual value to score yet (an unentered metric shows its target/formula
   on the audit page, just no score). */
function computeMetricScore(formulaConfig, actualValue, resolvedTarget) {
  if (actualValue === null || actualValue === undefined || actualValue === '') return null;

  if (formulaConfig.kind === 'manual_score') {
    const n = Number(actualValue);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  }

  // Same math as 'ratio', but the target is resolved per-employee (see
  // kpi_employee_targets) instead of fixed in formula_config — for the
  // handful of metrics whose target genuinely varies per person
  // (Production D1/D4). No target set yet for this employee/quarter ->
  // null (unscored, same as any other not-yet-configured metric), not an
  // error — a manager/admin just hasn't set it yet.
  if (formulaConfig.kind === 'ratio_employee_target') {
    const n = Number(actualValue);
    if (!Number.isFinite(n) || !resolvedTarget) return null;
    return Math.max(0, (n / resolvedTarget) * 100);
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

function createKpiScoringService({
  employeeRepository, employeeModel, departmentRepository, kpiDefinitionRepository, kpiScoreRepository,
  pillarAReviewRepository, selfEvaluationRepository, kpiNotificationRepository,
  kpiEmployeeTargetRepository, kpiAutoMetricMappingRepository, kpiClickupMetricsService,
  audit, roles, logger, teamMembership,
}) {
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

  // Self-evaluation is intentionally shaped like Pillar A (same 6
  // dimensions) so the frontend can render them side by side, but it is
  // never added into final.total — see docs/adr/0012-kpi-evaluation-
  // lifecycle.md for why this stays a comparison-only view.
  function buildSelfEvaluation(row) {
    if (!row) return null;
    const dimensions = PILLAR_A_DIMENSIONS.map((dim) => {
      const raw = row[dim.key];
      const score = raw === null || raw === undefined ? null : Number(raw);
      return { key: dim.key, label: dim.label, score };
    });
    return { dimensions, comment: row.comment || null, submittedAt: row.updated_at };
  }

  function buildPillarB(definitions, scoresByMetric, employeeId, quarter) {
    if (definitions.length === 0) {
      return { defined: false, metrics: [], total: 0, maxTotal: 0 };
    }
    const metrics = definitions.map((def) => {
      const scoreRow = scoresByMetric[def.metric_id];
      const formulaConfig = JSON.parse(def.formula_config);
      const actualValue = scoreRow ? scoreRow.actual_value : null;
      let employeeTarget = null;
      if (formulaConfig.kind === 'ratio_employee_target') {
        const targetRow = kpiEmployeeTargetRepository.findOne(employeeId, quarter, def.metric_id);
        employeeTarget = targetRow ? targetRow.target_value : null;
      }
      const score = scoreRow ? scoreRow.computed_score : computeMetricScore(formulaConfig, actualValue, employeeTarget);
      const weightedPoints = score === null ? null : (score / 100) * def.weight_pct;
      return {
        metricId: def.metric_id,
        pillar: def.pillar,
        name: def.name,
        target: def.target_text,
        employeeTarget,
        formulaConfig,
        sourceType: def.source_type,
        weightPct: def.weight_pct,
        actualValue,
        score,
        weightedPoints,
        comment: scoreRow ? scoreRow.comment : null,
        enteredBy: scoreRow ? scoreRow.entered_by : null,
        enteredAt: scoreRow ? scoreRow.entered_at : null,
        scoreSource: scoreRow ? scoreRow.source : null,
      };
    });
    const total = metrics.reduce((sum, m) => sum + (m.weightedPoints || 0), 0);
    const maxTotal = definitions.reduce((sum, d) => sum + d.weight_pct, 0);
    return { defined: true, metrics, total, maxTotal };
  }

  /* The one calculation path — the employee-facing dashboard, the KPI
     calculation/audit page, Performance History, and Team Performance all
     call this and render different views of the same result, so there's
     no second calculator that could drift from the first. */
  function computeBreakdown(employeeId, quarter) {
    const employee = employeeRepository.findById(employeeId);
    if (!employee) throw new EmployeesError('Employee not found.', 404);

    const reviewRow = pillarAReviewRepository.findByEmployeeAndQuarter(employeeId, quarter);
    const pillarA = buildPillarA(reviewRow);
    const selfEvaluation = buildSelfEvaluation(selfEvaluationRepository.findByEmployeeAndQuarter(employeeId, quarter));

    const definitions = employee.kpi_profile
      ? kpiDefinitionRepository.findByProfileAndQuarter(employee.kpi_profile, quarter)
      : [];
    const scoreRows = kpiScoreRepository.findByEmployeeAndQuarter(employeeId, quarter);
    const scoresByMetric = {};
    for (const row of scoreRows) scoresByMetric[row.metric_id] = row;
    const pillarB = buildPillarB(definitions, scoresByMetric, employeeId, quarter);

    const pillarAWeighted = pillarA.total; // already 0-60, no further scaling
    const pillarBWeighted = pillarB.total; // already 0-40 (or less if not fully entered)
    const finalScore = pillarAWeighted + pillarBWeighted;
    const statusBand = computeStatusBand(finalScore);

    return {
      employeeId,
      quarter,
      kpiProfile: employee.kpi_profile,
      pillarA,
      pillarB,
      selfEvaluation,
      final: {
        pillarAWeighted,
        pillarAWeightPct: PILLAR_A_WEIGHT_PCT,
        pillarBWeighted,
        pillarBWeightPct: PILLAR_B_WEIGHT_PCT,
        total: finalScore,
        achievementPct: finalScore,
        statusBand,
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

  function getCurrentKpiQuarter() {
    return kpiScoreRepository.getCurrentQuarter();
  }

  // Every quarter the framework has been seeded for — backs the quarter
  // dropdown (not free text) everywhere in the UI.
  function listAvailableQuarters() {
    return kpiDefinitionRepository.listDistinctQuarters();
  }

  // Read-only display math — "quarter closes on X" / days remaining.
  // Reuses quarterCloseTimestampUtc (also used by commercial-leads' freeze
  // job) rather than re-deriving quarter-boundary math a second time.
  function computeQuarterDeadline(quarter) {
    const closesAt = quarterCloseTimestampUtc(quarter);
    const daysRemaining = Math.max(0, Math.ceil((new Date(closesAt).getTime() - Date.now()) / (24 * 3600 * 1000)));
    return { quarter, closesAt, daysRemaining };
  }

  function enterManualScore({ employeeId, quarter, metricId, actualValue, comment, actorEmployee, actorAuthRole, actorId, ip }) {
    const employee = employeeRepository.findById(employeeId);
    if (!employee) throw new EmployeesError('Employee not found.', 404);
    if (!actorEmployee || (actorAuthRole !== roles.PEOPLE_CULTURE && actorEmployee.id !== employee.manager_employee_id)) {
      throw new EmployeesError('You do not have permission to enter KPI scores for this employee.', 403);
    }
    const definitions = kpiDefinitionRepository.findByProfileAndQuarter(employee.kpi_profile, quarter);
    const definition = definitions.find((d) => d.metric_id === metricId);
    if (!definition) throw new EmployeesError('Unknown KPI metric for this role/quarter.', 404);

    const formulaConfig = JSON.parse(definition.formula_config);
    let employeeTarget = null;
    if (formulaConfig.kind === 'ratio_employee_target') {
      const targetRow = kpiEmployeeTargetRepository.findOne(employeeId, quarter, metricId);
      employeeTarget = targetRow ? targetRow.target_value : null;
    }
    const score = computeMetricScore(formulaConfig, actualValue, employeeTarget);
    // A ratio_employee_target metric with no target set yet is allowed to
    // save unscored (a manager/admin just hasn't set the target yet) —
    // every other kind still rejects a value it genuinely can't score.
    if (score === null && formulaConfig.kind !== 'ratio_employee_target') {
      throw new EmployeesError('Could not compute a score from that value.');
    }

    const result = kpiScoreRepository.upsert({
      employeeId, quarter, metricId, actualValue, computedScore: score,
      enteredBy: actorEmployee.id, source: 'manual', comment,
    });

    audit.record({
      userId: actorId,
      action: 'kpi.metric_score.enter',
      entityType: 'kpi_score',
      entityId: String(result.id),
      details: { employeeId, quarter, metricId, actualValue, computedScore: score, comment: comment || null },
      ip,
    });

    // Only the ones carrying feedback worth surfacing — a routine numeric
    // re-entry with no comment isn't something the employee needs pinged
    // about, but a comment attached to a score is the actual signal.
    if (comment && employee.user_id) {
      kpiNotificationRepository.insert({
        userId: employee.user_id,
        type: 'metric_comment',
        title: `New feedback on ${definition.name}`,
        body: comment,
        link: `${employeeId}:${quarter}`,
      });
    }

    return result;
  }

  // Deliberately narrower than enterManualScore's permission check — the
  // manager or admin auth role only, never P&C — per the confirmed
  // decision that per-employee delivery targets are an operational/
  // production call, not an HR one. Gated on the auth role itself (any
  // manager, not specifically this employee's own manager_employee_id) —
  // corrected from an earlier misreading of the same instruction.
  function setEmployeeTarget({ employeeId, quarter, metricId, targetValue, actorEmployee, actorAuthRole, actorId, ip }) {
    const employee = employeeRepository.findById(employeeId);
    if (!employee) throw new EmployeesError('Employee not found.', 404);
    if (actorAuthRole !== roles.ADMIN && actorAuthRole !== roles.MANAGER) {
      throw new EmployeesError('You do not have permission to set targets for this employee.', 403);
    }
    const definitions = kpiDefinitionRepository.findByProfileAndQuarter(employee.kpi_profile, quarter);
    const definition = definitions.find((d) => d.metric_id === metricId);
    if (!definition) throw new EmployeesError('Unknown KPI metric for this role/quarter.', 404);
    const formulaConfig = JSON.parse(definition.formula_config);
    if (formulaConfig.kind !== 'ratio_employee_target') {
      throw new EmployeesError('This metric does not use a per-employee target.');
    }
    const n = Number(targetValue);
    if (!Number.isFinite(n) || n <= 0) throw new EmployeesError('Target must be a positive number.');

    const result = kpiEmployeeTargetRepository.upsert({ employeeId, quarter, metricId, targetValue: n, setBy: actorEmployee ? actorEmployee.id : null });

    audit.record({
      userId: actorId,
      action: 'kpi.employee_target.set',
      entityType: 'kpi_employee_target',
      entityId: String(result.id),
      details: { employeeId, quarter, metricId, targetValue: n },
      ip,
    });

    return result;
  }

  function getEmployeeTargets(employeeId, quarter) {
    return kpiEmployeeTargetRepository.findByEmployeeAndQuarter(employeeId, quarter);
  }

  // Self-eval is always self-only — the caller (controller) already
  // enforces employeeId === req.employee.id before this is reached, this
  // is the belt for that suspender.
  function enterSelfEvaluation({ employeeId, quarter, dimensions, comment, actorEmployee, actorId, ip }) {
    if (!actorEmployee || actorEmployee.id !== employeeId) {
      throw new EmployeesError('You can only submit your own self-evaluation.', 403);
    }
    const dimKeys = PILLAR_A_DIMENSIONS.map((d) => d.key);
    for (const key of dimKeys) {
      const v = dimensions[key];
      if (v !== undefined && v !== null && (typeof v !== 'number' || v < 0 || v > 10)) {
        throw new EmployeesError(`${key} must be a number from 0 to 10.`);
      }
    }

    const row = selfEvaluationRepository.upsert({
      employeeId, quarter,
      communication: dimensions.communication, collaboration: dimensions.collaboration,
      reliability: dimensions.reliability, attitude: dimensions.attitude,
      contribution: dimensions.contribution, growth: dimensions.growth,
      comment,
    });

    audit.record({
      userId: actorId,
      action: 'kpi.self_evaluation.enter',
      entityType: 'kpi_self_evaluation',
      entityId: String(row.id),
      details: { employeeId, quarter, dimensions },
      ip,
    });

    return row;
  }

  // All quarters with any recorded data (scores or Pillar A review) for
  // this employee, newest first — drives the Performance History picker.
  function listQuartersWithHistory(employeeId) {
    const quarters = new Set([
      ...kpiScoreRepository.listQuartersWithData(employeeId),
      ...pillarAReviewRepository.listQuartersWithData(employeeId),
    ]);
    return Array.from(quarters).sort().reverse();
  }

  // Reuses computeBreakdown per quarter — no parallel history-specific
  // calculator, same rule as the rest of this service.
  function computeHistory(employeeId) {
    const quarters = listQuartersWithHistory(employeeId);
    return quarters.map((quarter) => computeBreakdown(employeeId, quarter));
  }

  function exportHistoryCsv(employeeId) {
    const rows = computeHistory(employeeId);
    const header = ['quarter', 'pillarAScore', 'pillarBScore', 'finalScore', 'statusBand'];
    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push([
        row.quarter,
        row.final.pillarAWeighted.toFixed(1),
        row.final.pillarBWeighted.toFixed(1),
        row.final.total.toFixed(1),
        row.final.statusBand.label,
      ].join(','));
    }
    return lines.join('\n');
  }

  function computeRequiredActions({ actorEmployee, actorAuthRole, quarter }) {
    const actions = [];

    if (actorEmployee && !selfEvaluationRepository.existsForQuarter(actorEmployee.id, quarter)) {
      actions.push({ type: 'self_evaluation', employeeId: actorEmployee.id, message: `Submit your self-evaluation for ${quarter}` });
    }

    const isPeopleCulture = actorAuthRole === roles.PEOPLE_CULTURE || actorAuthRole === roles.ADMIN;
    const reports = actorEmployee ? employeeRepository.findByManagerId(actorEmployee.id) : [];
    const reportIds = new Set(reports.map((r) => r.id));

    if (!isPeopleCulture && reports.length === 0) return actions;

    const missingScores = kpiScoreRepository.findMissingCountsByQuarter(quarter)
      .filter((row) => isPeopleCulture || reportIds.has(row.employee_id));
    for (const row of missingScores) {
      actions.push({
        type: 'missing_kpi_scores',
        employeeId: row.employee_id,
        missingCount: row.defs_count - row.entered_count,
        message: `${row.defs_count - row.entered_count} Pillar B metric(s) not yet entered`,
      });
    }

    if (isPeopleCulture) {
      for (const employeeId of pillarAReviewRepository.findMissingForQuarter(quarter)) {
        actions.push({ type: 'missing_pillar_a', employeeId, message: 'Pillar A review not yet entered' });
      }
    }

    return actions;
  }

  function summaryRow(row, quarter) {
    const breakdown = computeBreakdown(row.id, quarter);
    const entry = employeeModel.toDirectoryEntry(row);
    return {
      employeeId: row.id,
      firstName: entry.firstName,
      lastName: entry.lastName,
      kpiProfile: row.kpi_profile,
      total: breakdown.final.total,
      statusBand: breakdown.final.statusBand,
      // Surfaced so manager/admin's Team Performance view can badge whoever
      // runs each team/department — same source as the roster's own
      // "Team Head" badge (employees.is_team_head), not derived here.
      isTeamHead: entry.isTeamHead,
    };
  }

  // Permission to view this page at all, for a non-company-wide actor, is
  // "do you currently manage anyone" — the same dynamic, reports-driven
  // definition teamMembership uses everywhere else, not the is_team_head
  // flag (which is independently assignable and can drift out of sync; see
  // teamMembership.js). This also matches the frontend's own tab-visibility
  // gate (kpi.js's kpiPerms.hasReports), which was already reports-based —
  // previously the two disagreed, so someone with a report but
  // is_team_head=false saw the tab and then got a 403 clicking into it.
  //
  // Once permitted, membership is teamMembership's shared rule: direct
  // reports (reporting-line FK) plus the rest of the employee's department,
  // deduplicated. Same rule the "My Team" tab uses (rosterService.getMyTeam)
  // — one place decides who's on a team, not a second copy here.
  //
  // Manager (this org's CEO account) or admin sees two things, not one
  // company-wide list: `myTeam` (their own direct reports, same FK as
  // above) plus `byDepartment` (every department's real, current
  // membership, independent of `myTeam` — an employee who is both a
  // direct report and a department member appears in both; that overlap
  // is intentional, confirmed with the user, not deduplicated).
  function computeTeamSummary({ actorEmployee, actorAuthRole, quarter }) {
    const isCompanyWide = actorAuthRole === roles.MANAGER || actorAuthRole === roles.ADMIN;
    const directReports = actorEmployee ? employeeRepository.findByManagerId(actorEmployee.id) : [];
    if (!isCompanyWide && directReports.length === 0) {
      throw new EmployeesError('You do not have permission to view the team performance summary.', 403);
    }

    if (!isCompanyWide) {
      const departmentMembers = actorEmployee.department
        ? employeeRepository.findByDepartment(actorEmployee.department, actorEmployee.id)
        : [];
      const { members } = teamMembership.resolveTeamMembership({ directReports, departmentMembers });
      return members.map((row) => summaryRow(row, quarter));
    }

    const myTeam = actorEmployee ? employeeRepository.findByManagerId(actorEmployee.id).map((row) => summaryRow(row, quarter)) : [];

    const allActive = employeeRepository.findAllActive();
    const byDepartment = {};
    for (const dept of departmentRepository.findAll()) {
      const members = allActive.filter((row) => row.department === dept.code).map((row) => summaryRow(row, quarter));
      if (members.length > 0) byDepartment[dept.label] = members;
    }

    return { myTeam, byDepartment };
  }

  // Mapping config is workspace-configuration knowledge, not HR data —
  // admin-only, same narrower bar as target-setting (P&C excluded).
  function requireAdmin(actorAuthRole) {
    if (actorAuthRole !== roles.ADMIN) throw new EmployeesError('You do not have permission to manage ClickUp metric mappings.', 403);
  }

  function listAutoMetricMappings({ actorAuthRole }) {
    requireAdmin(actorAuthRole);
    return kpiAutoMetricMappingRepository.findAll();
  }

  function setAutoMetricMapping({ kpiProfile, metricId, method, config, active, actorAuthRole, actorEmployee, ip }) {
    requireAdmin(actorAuthRole);
    if (!KPI_PROFILES.includes(kpiProfile)) throw new EmployeesError('Unknown kpi_profile.');
    const validMethods = ['status_entry_count', 'time_in_status_avg', 'tagged_task_count', 'due_date_on_time_rate'];
    if (!validMethods.includes(method)) throw new EmployeesError('Unknown mapping method.');
    if (!config || !Array.isArray(config.listIds) || config.listIds.length === 0) {
      throw new EmployeesError('At least one ClickUp list ID is required.');
    }

    const result = kpiAutoMetricMappingRepository.upsert({ kpiProfile, metricId, method, config, active, createdBy: actorEmployee ? actorEmployee.id : null });

    audit.record({
      userId: actorEmployee ? actorEmployee.id : null,
      action: 'kpi.auto_metric_mapping.set',
      entityType: 'kpi_auto_metric_mapping',
      entityId: String(result.id),
      details: { kpiProfile, metricId, method, config },
      ip,
    });

    return result;
  }

  function removeAutoMetricMapping({ kpiProfile, metricId, actorAuthRole }) {
    requireAdmin(actorAuthRole);
    kpiAutoMetricMappingRepository.remove(kpiProfile, metricId);
  }

  // One mapping row's raw value for one employee this quarter — never
  // writes anything, purely a lookup. `method` dispatches to the matching
  // kpiClickupMetricsService primitive with that mapping's own config
  // (list ids, status/tag names) — nothing here is hardcoded to any
  // particular role/list's real shape.
  async function computeMappingValue(mapping, employee, quarter) {
    const listIds = mapping.config.listIds || [];
    if (mapping.method === 'status_entry_count') {
      return kpiClickupMetricsService.countStatusEntries({ employeeId: employee.id, listIds, toStatus: mapping.config.toStatus, quarter });
    }
    if (!employee.clickup_user_id) return null; // the other 3 methods all call ClickUp directly by user id
    if (mapping.method === 'time_in_status_avg') {
      return kpiClickupMetricsService.avgTimeInStatus({ clickupUserId: employee.clickup_user_id, listIds, statusName: mapping.config.statusName, quarter });
    }
    if (mapping.method === 'tagged_task_count') {
      return kpiClickupMetricsService.countClosedTasksByTag({
        clickupUserId: employee.clickup_user_id, listIds, tag: mapping.config.tag,
        closedStatuses: mapping.config.closedStatuses || [], quarter,
      });
    }
    if (mapping.method === 'due_date_on_time_rate') {
      return kpiClickupMetricsService.dueDateOnTimeRate({ clickupUserId: employee.clickup_user_id, listIds, quarter });
    }
    return null;
  }

  // Walks every active mapping, every employee whose kpi_profile matches
  // it, computes a value, and writes it into kpi_scores with source:
  // 'auto' — reusing the exact same upsert a manual entry uses (a manual
  // save on the same metric always overwrites this on its next call,
  // since upsert is last-write-wins regardless of source). One mapping or
  // one employee failing (a deleted ClickUp list, an employee with no
  // clickup_user_id) is logged and skipped — it can never abort the rest
  // of the run.
  async function computeAutoScores(quarter) {
    const mappings = kpiAutoMetricMappingRepository.findAllActive();
    const employees = employeeRepository.findAllActive();
    const results = { computed: 0, skipped: 0 };

    for (const mapping of mappings) {
      const candidates = employees.filter((e) => e.kpi_profile === mapping.kpi_profile);
      const definitions = kpiDefinitionRepository.findByProfileAndQuarter(mapping.kpi_profile, quarter);
      const definition = definitions.find((d) => d.metric_id === mapping.metric_id);
      if (!definition) { results.skipped += candidates.length; continue; }
      const formulaConfig = JSON.parse(definition.formula_config);

      for (const employee of candidates) {
        try {
          const value = await computeMappingValue(mapping, employee, quarter);
          if (value === null || value === undefined) { results.skipped += 1; continue; }

          let resolvedTarget = null;
          if (formulaConfig.kind === 'ratio_employee_target') {
            const targetRow = kpiEmployeeTargetRepository.findOne(employee.id, quarter, mapping.metric_id);
            resolvedTarget = targetRow ? targetRow.target_value : null;
          }
          const score = computeMetricScore(formulaConfig, value, resolvedTarget);
          if (score === null) { results.skipped += 1; continue; }

          kpiScoreRepository.upsert({
            employeeId: employee.id, quarter, metricId: mapping.metric_id,
            actualValue: value, computedScore: score, enteredBy: null, source: 'auto',
          });
          results.computed += 1;
        } catch (error) {
          results.skipped += 1;
          if (logger) {
            logger.warn('computeAutoScores: mapping failed for employee, skipped', {
              kpiProfile: mapping.kpi_profile, metricId: mapping.metric_id, employeeId: employee.id, error: error.message,
            });
          }
        }
      }
    }
    return results;
  }

  return {
    computeMetricScore,
    computeBreakdown,
    computeStatusBand,
    getFrameworkDefinition,
    getCurrentKpiQuarter,
    listAvailableQuarters,
    computeQuarterDeadline,
    enterManualScore,
    setEmployeeTarget,
    getEmployeeTargets,
    enterSelfEvaluation,
    listQuartersWithHistory,
    computeHistory,
    exportHistoryCsv,
    computeRequiredActions,
    computeTeamSummary,
    computeAutoScores,
    listAutoMetricMappings,
    setAutoMetricMapping,
    removeAutoMetricMapping,
    PILLAR_A_DIMENSIONS,
  };
}

module.exports = createKpiScoringService;
