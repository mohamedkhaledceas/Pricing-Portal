const { EmployeesError } = require('../errors');

function canViewBreakdown({ actorAuthRole, actorEmployee, targetEmployee, roles }) {
  if (actorAuthRole === roles.ADMIN || actorAuthRole === roles.PEOPLE_CULTURE) return true;
  if (!actorEmployee) return false;
  if (actorEmployee.id === targetEmployee.id) return true;
  return targetEmployee.managerEmployeeId === actorEmployee.id;
}

// No local try/catch — EmployeesError extends the shared AppError, so a
// thrown error is auto-forwarded by Express to errorHandler.js, which
// already renders it correctly and now logs it with a correlation ID.
function createKpiController({ kpiScoringService, employeeRepository, employeeModel, kpiNotificationRepository, kpiClickupListRepository, kpiPeerReviewService, roles }) {
  function requireTargetEmployee(employeeId) {
    const targetEmployee = employeeModel.toEmployee(employeeRepository.findById(employeeId));
    if (!targetEmployee) throw new EmployeesError('Employee not found.', 404);
    return targetEmployee;
  }

  function requireCanView(req, targetEmployee) {
    if (!canViewBreakdown({ actorAuthRole: req.user.role, actorEmployee: req.employee, targetEmployee, roles })) {
      throw new EmployeesError('You do not have permission to view this employee\'s KPI data.', 403);
    }
  }

  function getFramework(req, res) {
    const quarter = req.query.quarter;
    if (!quarter) throw new EmployeesError('quarter query parameter is required.');
    const framework = kpiScoringService.getFrameworkDefinition(req.params.kpiProfile, quarter);
    return res.json(framework);
  }

  function getCurrentQuarter(req, res) {
    const quarter = kpiScoringService.getCurrentKpiQuarter();
    return res.json({ quarter, deadline: kpiScoringService.computeQuarterDeadline(quarter) });
  }

  function getAvailableQuarters(req, res) {
    return res.json({ quarters: kpiScoringService.listAvailableQuarters() });
  }

  function getBreakdown(req, res) {
    const quarter = req.query.quarter;
    if (!quarter) throw new EmployeesError('quarter query parameter is required.');
    const employeeId = Number(req.params.employeeId);
    const targetEmployee = requireTargetEmployee(employeeId);
    requireCanView(req, targetEmployee);
    const breakdown = kpiScoringService.computeBreakdown(employeeId, quarter);
    return res.json(breakdown);
  }

  function getHistory(req, res) {
    const employeeId = Number(req.params.employeeId);
    const targetEmployee = requireTargetEmployee(employeeId);
    requireCanView(req, targetEmployee);
    const breakdowns = kpiScoringService.computeHistory(employeeId);
    return res.json({ employeeId, quarters: breakdowns.map((b) => b.quarter), breakdowns });
  }

  function exportHistory(req, res) {
    const employeeId = Number(req.params.employeeId);
    const targetEmployee = requireTargetEmployee(employeeId);
    requireCanView(req, targetEmployee);
    const csv = kpiScoringService.exportHistoryCsv(employeeId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="kpi-history-${employeeId}.csv"`);
    return res.send(csv);
  }

  function enterManualScore(req, res) {
    const body = req.body || {};
    const score = kpiScoringService.enterManualScore({
      employeeId: Number(req.params.employeeId),
      quarter: body.quarter,
      metricId: body.metricId,
      actualValue: body.actualValue,
      comment: body.comment,
      actorEmployee: req.employee,
      actorAuthRole: req.user.role,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.status(201).json({ score });
  }

  function getTargets(req, res) {
    const employeeId = Number(req.params.employeeId);
    const quarter = req.query.quarter;
    if (!quarter) throw new EmployeesError('quarter query parameter is required.');
    const targetEmployee = requireTargetEmployee(employeeId);
    requireCanView(req, targetEmployee);
    return res.json({ targets: kpiScoringService.getEmployeeTargets(employeeId, quarter) });
  }

  function setTarget(req, res) {
    const body = req.body || {};
    const target = kpiScoringService.setEmployeeTarget({
      employeeId: Number(req.params.employeeId),
      quarter: body.quarter,
      metricId: body.metricId,
      targetValue: body.targetValue,
      actorEmployee: req.employee,
      actorAuthRole: req.user.role,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.status(201).json({ target });
  }

  function enterSelfEvaluation(req, res) {
    const body = req.body || {};
    const employeeId = Number(req.params.employeeId);
    if (!req.employee || req.employee.id !== employeeId) {
      throw new EmployeesError('You can only submit your own self-evaluation.', 403);
    }
    const dims = ['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'];
    const dimensions = {};
    for (const key of dims) dimensions[key] = body[key];

    const review = kpiScoringService.enterSelfEvaluation({
      employeeId,
      quarter: body.quarter,
      dimensions,
      comment: body.comment,
      actorEmployee: req.employee,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.status(201).json({ review });
  }

  function getRequiredActions(req, res) {
    const quarter = req.query.quarter || kpiScoringService.getCurrentKpiQuarter();
    const actions = kpiScoringService.computeRequiredActions({
      actorEmployee: req.employee,
      actorAuthRole: req.user.role,
      quarter,
    });
    const employeeIds = Array.from(new Set(actions.map((a) => a.employeeId)));
    const names = {};
    for (const id of employeeIds) {
      const entry = employeeModel.toDirectoryEntry(employeeRepository.findById(id));
      if (entry) names[id] = `${entry.firstName} ${entry.lastName}`;
    }
    return res.json({ quarter, actions: actions.map((a) => ({ ...a, employeeName: names[a.employeeId] || null })) });
  }

  function getTeamSummary(req, res) {
    const quarter = req.query.quarter || kpiScoringService.getCurrentKpiQuarter();
    const summary = kpiScoringService.computeTeamSummary({
      actorEmployee: req.employee,
      actorAuthRole: req.user.role,
      quarter,
    });
    return res.json({ quarter, summary });
  }

  function listAutoMetricMappings(req, res) {
    return res.json({ mappings: kpiScoringService.listAutoMetricMappings({ actorAuthRole: req.user.role }) });
  }

  function setAutoMetricMapping(req, res) {
    const body = req.body || {};
    const mapping = kpiScoringService.setAutoMetricMapping({
      kpiProfile: body.kpiProfile,
      metricId: body.metricId,
      method: body.method,
      config: body.config,
      active: body.active,
      actorAuthRole: req.user.role,
      actorEmployee: req.employee,
      ip: req.ip,
    });
    return res.status(201).json({ mapping });
  }

  function removeAutoMetricMapping(req, res) {
    kpiScoringService.removeAutoMetricMapping({
      kpiProfile: req.params.kpiProfile,
      metricId: req.params.metricId,
      actorAuthRole: req.user.role,
    });
    return res.status(204).end();
  }

  function listClickupLists(req, res) {
    if (req.user.role !== roles.ADMIN) throw new EmployeesError('You do not have permission to view this.', 403);
    return res.json({ lists: kpiClickupListRepository.findAll() });
  }

  async function runComputeAutoScores(req, res) {
    if (req.user.role !== roles.ADMIN) throw new EmployeesError('You do not have permission to run this.', 403);
    const quarter = (req.body && req.body.quarter) || kpiScoringService.getCurrentKpiQuarter();
    const result = await kpiScoringService.computeAutoScores(quarter);
    return res.json({ quarter, ...result });
  }

  function getReviewWindow(req, res) {
    const quarter = req.query.quarter || kpiScoringService.getCurrentKpiQuarter();
    return res.json(kpiPeerReviewService.getWindow(quarter));
  }

  function setReviewWindow(req, res) {
    const body = req.body || {};
    const window = kpiPeerReviewService.setWindow({
      quarter: body.quarter,
      opensAt: body.opensAt,
      closesAt: body.closesAt,
      actorAuthRole: req.user.role,
      actorEmployee: req.employee,
      ip: req.ip,
    });
    return res.status(201).json({ window });
  }

  function getPeerReviewRoster(req, res) {
    const quarter = req.query.quarter || kpiScoringService.getCurrentKpiQuarter();
    return res.json({ quarter, roster: kpiPeerReviewService.getRoster({ actorEmployee: req.employee, quarter }) });
  }

  function submitPeerReview(req, res) {
    const body = req.body || {};
    const dims = ['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'];
    const dimensions = {};
    for (const key of dims) dimensions[key] = body[key];

    const response = kpiPeerReviewService.submitReview({
      reviewerEmployeeId: req.employee ? req.employee.id : null,
      revieweeEmployeeId: Number(req.params.revieweeId),
      quarter: body.quarter,
      workedWith: body.workedWith !== false,
      dimensions,
      comment: body.comment,
      actorEmployee: req.employee,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.status(201).json({ response: { id: response.id, revieweeEmployeeId: response.reviewee_employee_id, quarter: response.quarter } });
  }

  function getPeerReviewCompletion(req, res) {
    const quarter = req.query.quarter || kpiScoringService.getCurrentKpiQuarter();
    return res.json({ quarter, completion: kpiPeerReviewService.getCompletion({ quarter, actorAuthRole: req.user.role }) });
  }

  function getPeerReviewCounter(req, res) {
    const quarter = req.query.quarter || kpiScoringService.getCurrentKpiQuarter();
    return res.json({ quarter, ...kpiPeerReviewService.getSubmissionCounter({ quarter, actorAuthRole: req.user.role }) });
  }

  function getMyPeerReviewStatus(req, res) {
    const quarter = req.query.quarter || kpiScoringService.getCurrentKpiQuarter();
    return res.json({ quarter, ...kpiPeerReviewService.getMyStatus({ actorEmployee: req.employee, quarter }) });
  }

  function listNotifications(req, res) {
    const notifications = kpiNotificationRepository.listForUser(req.user.id);
    const unreadCount = kpiNotificationRepository.countUnreadForUser(req.user.id);
    return res.json({ notifications, unreadCount });
  }

  function markNotificationRead(req, res) {
    const notification = kpiNotificationRepository.markRead(Number(req.params.id), req.user.id);
    return res.json({ notification });
  }

  return {
    getFramework,
    getCurrentQuarter,
    getAvailableQuarters,
    getBreakdown,
    getHistory,
    exportHistory,
    enterManualScore,
    getTargets,
    setTarget,
    listAutoMetricMappings,
    setAutoMetricMapping,
    removeAutoMetricMapping,
    listClickupLists,
    runComputeAutoScores,
    getReviewWindow,
    setReviewWindow,
    getPeerReviewRoster,
    submitPeerReview,
    getPeerReviewCompletion,
    getPeerReviewCounter,
    getMyPeerReviewStatus,
    enterSelfEvaluation,
    getRequiredActions,
    getTeamSummary,
    listNotifications,
    markNotificationRead,
  };
}

module.exports = createKpiController;
