/* The employees module's exposed interface for modules/pricing (Team &
   Salaries tab, Estimator staffing) — see docs/governance/
   business-portal-tracker.md §4 item 8. pricing never requires
   employeeRepository/employee.model directly; it calls the functions this
   file exposes through modules/employees/index.js, same shape as auth's
   provisionSelfRegisteredEmployee pattern already uses for the reverse
   direction (a narrow, explicit interface instead of a reach-through
   import).

   includeCompensation is a plain boolean the caller resolves from
   common/permissions.js's canViewCompensation(actorRole) before calling in
   — this module doesn't know or care about pricing's request/role
   handling, it just honors the flag it's given. */
function createPlannerExportService({ employeeRepository, employeeModel, audit }) {
  function listForPlanner({ includeCompensation }) {
    return employeeRepository.findAllActive().map((row) => employeeModel.toPlannerEntry(row, { includeCompensation }));
  }

  // Writes are audited here, in the module that owns the data, not in
  // pricing — matches CLAUDE.md's "any significant action calls
  // auditService.record" rule, and keeps the audit entityType consistent
  // with every other employee-field write in this module.
  function updateCompensation({ employeeId, patch, actorId, actorEmail, ip }) {
    const before = employeeRepository.findById(employeeId);
    if (!before) return null;

    const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const update = {};
    if ('salary' in patch) update.salary = numOrNull(patch.salary);
    if ('currency' in patch) update.currency = patch.currency || null;
    if ('defaultHours' in patch) update.defaultHours = numOrNull(patch.defaultHours);
    if ('defaultUtilizationPct' in patch) update.defaultUtilizationPct = numOrNull(patch.defaultUtilizationPct);
    if ('overrideRate' in patch) update.overrideRate = numOrNull(patch.overrideRate);

    employeeRepository.update(employeeId, update);
    const after = employeeRepository.findById(employeeId);

    audit.record({
      userId: actorId, username: actorEmail, action: 'employee.compensation_update',
      entityType: 'employee', entityId: employeeId,
      details: {
        before: { salary: before.salary, currency: before.currency, defaultHours: before.default_hours, defaultUtilizationPct: before.default_utilization_pct, overrideRate: before.override_rate },
        after: { salary: after.salary, currency: after.currency, defaultHours: after.default_hours, defaultUtilizationPct: after.default_utilization_pct, overrideRate: after.override_rate },
      },
      ip,
    });
    return employeeModel.toPlannerEntry(after, { includeCompensation: true });
  }

  return { listForPlanner, updateCompensation };
}

module.exports = createPlannerExportService;
