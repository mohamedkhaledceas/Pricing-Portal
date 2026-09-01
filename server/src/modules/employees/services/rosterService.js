const { EmployeesError } = require('../errors');

/* Manual CRUD by P&C/admin/manager — v1 phasing per the plan: automatic
   ClickUp roster sync is explicitly deferred. Access to roster management
   is gated on the auth role: admin (system-level escape hatch), people_culture,
   or manager (the CEO's role — full company-wide roster access, same as P&C). */
function createRosterService({ employeeRepository, employeeModel, leaveRequestRepository, audit, roles, deleteStoredPhoto }) {
  function canManageRoster({ actorAuthRole }) {
    return actorAuthRole === roles.ADMIN || actorAuthRole === roles.PEOPLE_CULTURE || actorAuthRole === roles.MANAGER;
  }

  function requireCanManageRoster({ actorAuthRole }) {
    if (!canManageRoster({ actorAuthRole })) {
      throw new EmployeesError('You do not have permission to manage the employee roster.', 403);
    }
  }

  // Local-date string, host-timezone — same shape leave_requests.start_date/
  // end_date are stored in and compared against (see
  // leaveRequestRepository.findApprovedOverlapping / overview.js's
  // matching client-side todayIso()). Never parsed as a Date, only compared
  // as text, so timezone doesn't matter as long as this and the stored
  // dates use the same convention.
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // 'on_leave' is never written to employees.status (see migration
  // 007's comment) — it's computed here from approved leave_requests
  // covering today, so the displayed status can't drift from a real
  // approved leave the way a manually-set third option could.
  function onLeaveEmployeeIdsToday() {
    return new Set(leaveRequestRepository.findApprovedOverlapping(todayIso()).map((r) => r.employee_id));
  }

  function decorateStatus(employee, onLeaveIds) {
    if (!employee) return employee;
    return onLeaveIds.has(employee.id) ? { ...employee, status: 'on_leave' } : employee;
  }

  function decorateStatusList(employees) {
    const onLeaveIds = onLeaveEmployeeIdsToday();
    return employees.map((e) => decorateStatus(e, onLeaveIds));
  }

  function decorateStatusOne(employee) {
    return decorateStatus(employee, onLeaveEmployeeIdsToday());
  }

  function listAll({ actorAuthRole }) {
    requireCanManageRoster({ actorAuthRole });
    return decorateStatusList(employeeRepository.findAll().map(employeeModel.toEmployee));
  }

  // No permission gate beyond being authenticated — name + department +
  // manager is the same non-sensitive info the old prototype hardcoded
  // into client JS for everyone; this is what a handover/manager picker
  // needs and nothing more (see employeeModel.toDirectoryEntry).
  function listDirectory() {
    return decorateStatusList(employeeRepository.findAllActive().map(employeeModel.toDirectoryEntry));
  }

  /* Null, not an error — signing up (getting a users row) and being
     onboarded as an employee (getting an employees row) are two separate
     steps by design (decision carried from the earlier plan review); a
     freshly-registered account legitimately has no employee record yet. */
  function getMine(userId) {
    return decorateStatusOne(employeeModel.toEmployee(employeeRepository.findByUserId(userId)));
  }

  function getDirectReports(managerEmployeeId) {
    return decorateStatusList(employeeRepository.findByManagerId(managerEmployeeId).map(employeeModel.toEmployee));
  }

  function create({
    actorAuthRole, userId, clickupUserId, department, kpiProfile, managerEmployeeId,
    jobTitle, employmentType, joiningDate, workLocation, workingHours, status, actorId, ip,
  }) {
    requireCanManageRoster({ actorAuthRole });
    if (!userId) throw new EmployeesError('userId is required.');
    if (employeeRepository.existsByUserId(userId)) {
      throw new EmployeesError('This account already has an employee record.', 409);
    }
    if (managerEmployeeId && !employeeRepository.findById(managerEmployeeId)) {
      throw new EmployeesError('Manager not found.');
    }
    if (status !== undefined && status !== null && status !== '' && !['active', 'remote'].includes(status)) {
      throw new EmployeesError("status must be 'active' or 'remote' — 'on_leave' is computed automatically from approved leave, not set directly.");
    }

    const created = employeeRepository.insert({
      userId, clickupUserId, department, kpiProfile, managerEmployeeId,
      jobTitle, employmentType, joiningDate, workLocation, workingHours, status,
    });
    audit.record({
      userId: actorId,
      action: 'employee.create',
      entityType: 'employee',
      entityId: String(created.id),
      details: { after: employeeModel.toEmployee(created) },
      ip,
    });
    return decorateStatusOne(employeeModel.toEmployee(created));
  }

  function update({
    actorAuthRole, targetId, clickupUserId, department, kpiProfile, managerEmployeeId,
    jobTitle, employmentType, joiningDate, workLocation, workingHours, status, actorId, ip,
  }) {
    requireCanManageRoster({ actorAuthRole });
    const target = employeeRepository.findById(targetId);
    if (!target) throw new EmployeesError('Employee not found.', 404);
    if (managerEmployeeId === targetId) throw new EmployeesError('An employee cannot be their own manager.');
    if (managerEmployeeId && !employeeRepository.findById(managerEmployeeId)) {
      throw new EmployeesError('Manager not found.');
    }
    if (status !== undefined && status !== null && status !== '' && !['active', 'remote'].includes(status)) {
      throw new EmployeesError("status must be 'active' or 'remote' — 'on_leave' is computed automatically from approved leave, not set directly.");
    }

    const before = employeeModel.toEmployee(target);
    const updated = employeeRepository.update(targetId, {
      clickupUserId, department, kpiProfile, managerEmployeeId,
      jobTitle, employmentType, joiningDate, workLocation, workingHours, status,
    });
    audit.record({
      userId: actorId,
      action: 'employee.update',
      entityType: 'employee',
      entityId: String(targetId),
      details: { before, after: employeeModel.toEmployee(updated) },
      ip,
    });
    return decorateStatusOne(employeeModel.toEmployee(updated));
  }

  function setActive({ actorAuthRole, targetId, active, actorId, ip }) {
    requireCanManageRoster({ actorAuthRole });
    const target = employeeRepository.findById(targetId);
    if (!target) throw new EmployeesError('Employee not found.', 404);
    if (!!target.active === !!active) {
      throw new EmployeesError(`That employee is already ${active ? 'active' : 'inactive'}.`);
    }

    const updated = employeeRepository.setActive(targetId, active);
    audit.record({
      userId: actorId,
      action: active ? 'employee.reactivate' : 'employee.deactivate',
      entityType: 'employee',
      entityId: String(targetId),
      details: { before: { active: !!target.active }, after: { active: !!active } },
      ip,
    });
    return decorateStatusOne(employeeModel.toEmployee(updated));
  }

  function setPhoto({ actorAuthRole, targetId, photoUrl, actorId, ip }) {
    requireCanManageRoster({ actorAuthRole });
    const target = employeeRepository.findById(targetId);
    if (!target) throw new EmployeesError('Employee not found.', 404);

    const before = employeeModel.toEmployee(target);
    const updated = employeeRepository.setPhoto(targetId, photoUrl);
    if (before.photoUrl && before.photoUrl !== photoUrl) deleteStoredPhoto(before.photoUrl);
    audit.record({
      userId: actorId,
      action: 'employee.photo_update',
      entityType: 'employee',
      entityId: String(targetId),
      details: { before: { photoUrl: before.photoUrl }, after: { photoUrl } },
      ip,
    });
    return decorateStatusOne(employeeModel.toEmployee(updated));
  }

  // Self-service — deliberately never takes a targetId. actorEmployee comes
  // from attachEmployee (req.employee), so there is structurally no way to
  // reach anyone else's row through this path, the same shape as
  // auth's /me/profile (see docs referenced in the plan for this feature).
  // photoUrl: null is the "remove my photo" case — same function handles
  // both, same as setPhoto above.
  function setMyPhoto({ actorEmployee, photoUrl, actorId, ip }) {
    if (!actorEmployee) {
      throw new EmployeesError('You need a completed employee profile before you can set a profile photo. Contact People & Culture.', 403);
    }
    const before = employeeModel.toEmployee(employeeRepository.findById(actorEmployee.id));
    const updated = employeeRepository.setPhoto(actorEmployee.id, photoUrl);
    if (before.photoUrl && before.photoUrl !== photoUrl) deleteStoredPhoto(before.photoUrl);
    audit.record({
      userId: actorId,
      action: 'employee.photo_update',
      entityType: 'employee',
      entityId: String(actorEmployee.id),
      details: { self: true, before: { photoUrl: before.photoUrl }, after: { photoUrl } },
      ip,
    });
    return decorateStatusOne(employeeModel.toEmployee(updated));
  }

  return { canManageRoster, listAll, listDirectory, getMine, getDirectReports, create, update, setActive, setPhoto, setMyPhoto };
}

module.exports = createRosterService;
