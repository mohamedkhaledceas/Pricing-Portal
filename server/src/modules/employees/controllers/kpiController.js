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
function createKpiController({ kpiScoringService, pillarAReviewRepository, employeeRepository, employeeModel, roles }) {
  function getFramework(req, res) {
    const quarter = req.query.quarter;
    if (!quarter) throw new EmployeesError('quarter query parameter is required.');
    const framework = kpiScoringService.getFrameworkDefinition(req.params.kpiProfile, quarter);
    return res.json(framework);
  }

  function getBreakdown(req, res) {
    const quarter = req.query.quarter;
    if (!quarter) throw new EmployeesError('quarter query parameter is required.');
    const employeeId = Number(req.params.employeeId);
    const targetEmployee = employeeModel.toEmployee(employeeRepository.findById(employeeId));
    if (!targetEmployee) throw new EmployeesError('Employee not found.', 404);
    if (!canViewBreakdown({ actorAuthRole: req.user.role, actorEmployee: req.employee, targetEmployee, roles })) {
      throw new EmployeesError('You do not have permission to view this KPI breakdown.', 403);
    }
    const breakdown = kpiScoringService.computeBreakdown(employeeId, quarter);
    return res.json(breakdown);
  }

  function enterManualScore(req, res) {
    const body = req.body || {};
    const score = kpiScoringService.enterManualScore({
      employeeId: Number(req.params.employeeId),
      quarter: body.quarter,
      metricId: body.metricId,
      actualValue: body.actualValue,
      actorEmployee: req.employee,
      actorAuthRole: req.user.role,
      actorId: req.user.id,
    });
    return res.status(201).json({ score });
  }

  /* P&C ingests the aggregated (anonymous) Google Form results here — the
     form itself stays external per KPI_Framework.xlsx §"Source: Anonymous
     Google Form"; this endpoint is only where the already-aggregated
     6-dimension scores land. No per-reviewer identity is ever accepted or
     stored (see the migration's schema comment). */
  function enterPillarA(req, res) {
    if (!req.employee || req.user.role !== roles.PEOPLE_CULTURE) {
      throw new EmployeesError('You do not have permission to enter Pillar A review results.', 403);
    }
    const body = req.body || {};
    const employeeId = Number(req.params.employeeId);
    if (!employeeRepository.findById(employeeId)) throw new EmployeesError('Employee not found.', 404);

    const dims = ['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'];
    for (const key of dims) {
      const v = body[key];
      if (v !== undefined && v !== null && (typeof v !== 'number' || v < 0 || v > 10)) {
        throw new EmployeesError(`${key} must be a number from 0 to 10.`);
      }
    }

    const review = pillarAReviewRepository.upsert({
      employeeId,
      quarter: body.quarter,
      communication: body.communication ?? null,
      collaboration: body.collaboration ?? null,
      reliability: body.reliability ?? null,
      attitude: body.attitude ?? null,
      contribution: body.contribution ?? null,
      growth: body.growth ?? null,
      responseCount: body.responseCount || 0,
      feedback: body.feedback || [],
      enteredBy: req.employee.id,
    });
    return res.status(201).json({ review });
  }

  return { getFramework, getBreakdown, enterManualScore, enterPillarA };
}

module.exports = createKpiController;
