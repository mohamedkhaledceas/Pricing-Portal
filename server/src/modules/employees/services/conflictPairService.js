const { EmployeesError } = require('../errors');

/* conflictPairRepository.js's data was inert until this pass — see the
   plan's §8. findOverlaps/getMyPartners below are the enforcement this
   file's own comment used to say wasn't implemented yet: warn-only, never
   blocking (submission always succeeds regardless of what this returns),
   surfaced at three read points (submit's response, the live form check,
   listTeam) rather than a new table or a push/notification system. */
function createConflictPairService({ conflictPairRepository, conflictPairModel, leaveRequestRepository, employeeRepository, audit, roles }) {
  function requireCanManage({ actorAuthRole }) {
    const allowed = actorAuthRole === roles.ADMIN || actorAuthRole === roles.PEOPLE_CULTURE;
    if (!allowed) {
      throw new EmployeesError('You do not have permission to manage conflict pairs.', 403);
    }
  }

  function requireDistinctExistingEmployees(employeeIdA, employeeIdB) {
    if (!employeeIdA || !employeeIdB || employeeIdA === employeeIdB) {
      throw new EmployeesError('Two distinct employees are required.');
    }
    if (!employeeRepository.findById(employeeIdA) || !employeeRepository.findById(employeeIdB)) {
      throw new EmployeesError('One or both employees were not found.');
    }
  }

  // (A,B) and (B,A) are the same pair — checked on both create and update
  // so the same two people can't end up with two separate rows. excludeId
  // lets update() skip flagging a pair against its own current row (e.g.
  // saving without actually changing anything).
  function requireNotDuplicate(employeeIdA, employeeIdB, excludeId) {
    const existing = conflictPairRepository.findByEmployees(employeeIdA, employeeIdB);
    if (existing && existing.id !== excludeId) {
      throw new EmployeesError('This pair already exists.');
    }
  }

  function list({ actorAuthRole }) {
    requireCanManage({ actorAuthRole });
    return conflictPairRepository.findAll().map(conflictPairModel.toConflictPair);
  }

  function create({ actorAuthRole, employeeIdA, employeeIdB, actorId, ip }) {
    requireCanManage({ actorAuthRole });
    requireDistinctExistingEmployees(employeeIdA, employeeIdB);
    requireNotDuplicate(employeeIdA, employeeIdB, null);
    const created = conflictPairRepository.insert({ employeeIdA, employeeIdB });
    audit.record({
      userId: actorId,
      action: 'conflict_pair.create',
      entityType: 'conflict_pair',
      entityId: String(created.id),
      details: { employeeIdA, employeeIdB },
      ip,
    });
    return conflictPairModel.toConflictPair(created);
  }

  // Changes which two employees a pair covers, in place — replaces the old
  // deactivate-and-recreate flow the same way departmentService.update
  // replaced deactivate for departments (see docs/adr/0011's cousin
  // reasoning): the pair's identity/history stays the row's `id`, only
  // its membership changes.
  function update({ actorAuthRole, id, employeeIdA, employeeIdB, actorId, ip }) {
    requireCanManage({ actorAuthRole });
    const existing = conflictPairRepository.findById(id);
    if (!existing) throw new EmployeesError('Conflict pair not found.', 404);
    requireDistinctExistingEmployees(employeeIdA, employeeIdB);
    requireNotDuplicate(employeeIdA, employeeIdB, id);

    const updated = conflictPairRepository.update(id, { employeeIdA, employeeIdB });
    audit.record({
      userId: actorId,
      action: 'conflict_pair.update',
      entityType: 'conflict_pair',
      entityId: String(id),
      details: {
        before: { employeeIdA: existing.employee_id_a, employeeIdB: existing.employee_id_b },
        after: { employeeIdA, employeeIdB },
      },
      ip,
    });
    return conflictPairModel.toConflictPair(updated);
  }

  // Hard delete — see conflictPairRepository.remove's own comment on why
  // this is safe here (no retained history, nothing references this row).
  function remove({ actorAuthRole, id, actorId, ip }) {
    requireCanManage({ actorAuthRole });
    const existing = conflictPairRepository.findById(id);
    if (!existing) throw new EmployeesError('Conflict pair not found.', 404);

    conflictPairRepository.remove(id);
    audit.record({
      userId: actorId,
      action: 'conflict_pair.delete',
      entityType: 'conflict_pair',
      entityId: String(id),
      details: { employeeIdA: existing.employee_id_a, employeeIdB: existing.employee_id_b },
      ip,
    });
  }

  // Active partner *employee ids* for one employee — a pair row doesn't
  // say which side is "self", so both employee_id_a/_b are checked.
  function activePartnerIds(employeeId) {
    return conflictPairRepository
      .findActiveForEmployee(employeeId)
      .map((pair) => (pair.employee_id_a === employeeId ? pair.employee_id_b : pair.employee_id_a));
  }

  // Self-only, no permission gate — same shape as rosterService.getMine:
  // an employee seeing who their own conflict partner is isn't privileged
  // data (they already see that colleague in the Teams directory), just
  // scoped so nobody can ask for anyone else's. Returns [] rather than
  // erroring when there's no employee profile yet, or no active pair.
  function getMyPartners(actorEmployee) {
    if (!actorEmployee) return [];
    return activePartnerIds(actorEmployee.id)
      .map((id) => employeeRepository.findById(id))
      .filter(Boolean)
      .map((row) => ({ id: row.id, firstName: row.user_first_name, lastName: row.user_last_name }));
  }

  // For `employeeId`, do any of their active conflict partner(s) already
  // have a still-relevant (pending/manager_approved/approved) request
  // overlapping [startDate, endDate]? Used identically by submit's
  // response, the live pre-submit form check, and listTeam's per-request
  // labeling — one calculation, three read surfaces, per the plan.
  function findOverlaps({ employeeId, startDate, endDate }) {
    const partnerIds = activePartnerIds(employeeId);
    if (!partnerIds.length) return [];
    const overlapping = leaveRequestRepository.findActiveOverlappingForEmployees({ employeeIds: partnerIds, startDate, endDate });
    return overlapping.map((row) => {
      const partner = employeeRepository.findById(row.employee_id);
      return {
        partnerEmployeeId: row.employee_id,
        partnerName: partner ? `${partner.user_first_name} ${partner.user_last_name}`.trim() : `Employee #${row.employee_id}`,
        status: row.status,
        startDate: row.start_date,
        endDate: row.end_date,
        leaveType: row.leave_type,
      };
    });
  }

  return { list, create, update, remove, getMyPartners, findOverlaps };
}

module.exports = createConflictPairService;
