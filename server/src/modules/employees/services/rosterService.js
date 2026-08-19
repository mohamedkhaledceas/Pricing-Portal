const { EmployeesError } = require('../errors');

/* Manual CRUD by P&C/admin — v1 phasing per the plan: automatic ClickUp
   roster sync is explicitly deferred. Access to roster management is an
   employees-domain permission, not auth's account-management permission
   (canManageUsers): it's gated on being an admin (system-level escape
   hatch) OR being flagged is_people_culture on one's OWN employee record —
   orthogonal to the auth role enum, per the plan's "three orthogonal
   concepts" section. */
function createRosterService({ employeeRepository, employeeModel, audit, roles }) {
  function canManageRoster({ actorAuthRole, actorEmployee }) {
    return actorAuthRole === roles.ADMIN || !!(actorEmployee && actorEmployee.isPeopleCulture);
  }

  function requireCanManageRoster({ actorAuthRole, actorEmployee }) {
    if (!canManageRoster({ actorAuthRole, actorEmployee })) {
      throw new EmployeesError('You do not have permission to manage the employee roster.', 403);
    }
  }

  function listAll({ actorAuthRole, actorEmployee }) {
    requireCanManageRoster({ actorAuthRole, actorEmployee });
    return employeeRepository.findAll().map(employeeModel.toEmployee);
  }

  // No permission gate beyond being authenticated — name + department +
  // manager is the same non-sensitive info the old prototype hardcoded
  // into client JS for everyone; this is what a handover/manager picker
  // needs and nothing more (see employeeModel.toDirectoryEntry).
  function listDirectory() {
    return employeeRepository.findAllActive().map(employeeModel.toDirectoryEntry);
  }

  /* Null, not an error — signing up (getting a users row) and being
     onboarded as an employee (getting an employees row) are two separate
     steps by design (decision carried from the earlier plan review); a
     freshly-registered account legitimately has no employee record yet. */
  function getMine(userId) {
    return employeeModel.toEmployee(employeeRepository.findByUserId(userId));
  }

  function getDirectReports(managerEmployeeId) {
    return employeeRepository.findByManagerId(managerEmployeeId).map(employeeModel.toEmployee);
  }

  function create({ actorAuthRole, actorEmployee, userId, clickupUserId, department, kpiProfile, managerEmployeeId, isPeopleCulture, actorId, ip }) {
    requireCanManageRoster({ actorAuthRole, actorEmployee });
    if (!userId) throw new EmployeesError('userId is required.');
    if (employeeRepository.existsByUserId(userId)) {
      throw new EmployeesError('This account already has an employee record.', 409);
    }
    if (managerEmployeeId && !employeeRepository.findById(managerEmployeeId)) {
      throw new EmployeesError('Manager not found.');
    }

    const created = employeeRepository.insert({ userId, clickupUserId, department, kpiProfile, managerEmployeeId, isPeopleCulture });
    audit.record({
      userId: actorId,
      action: 'employee.create',
      entityType: 'employee',
      entityId: String(created.id),
      details: { after: employeeModel.toEmployee(created) },
      ip,
    });
    return employeeModel.toEmployee(created);
  }

  function update({ actorAuthRole, actorEmployee, targetId, clickupUserId, department, kpiProfile, managerEmployeeId, isPeopleCulture, actorId, ip }) {
    requireCanManageRoster({ actorAuthRole, actorEmployee });
    const target = employeeRepository.findById(targetId);
    if (!target) throw new EmployeesError('Employee not found.', 404);
    if (managerEmployeeId === targetId) throw new EmployeesError('An employee cannot be their own manager.');
    if (managerEmployeeId && !employeeRepository.findById(managerEmployeeId)) {
      throw new EmployeesError('Manager not found.');
    }

    const before = employeeModel.toEmployee(target);
    const updated = employeeRepository.update(targetId, { clickupUserId, department, kpiProfile, managerEmployeeId, isPeopleCulture });
    audit.record({
      userId: actorId,
      action: 'employee.update',
      entityType: 'employee',
      entityId: String(targetId),
      details: { before, after: employeeModel.toEmployee(updated) },
      ip,
    });
    return employeeModel.toEmployee(updated);
  }

  function setActive({ actorAuthRole, actorEmployee, targetId, active, actorId, ip }) {
    requireCanManageRoster({ actorAuthRole, actorEmployee });
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
    return employeeModel.toEmployee(updated);
  }

  return { canManageRoster, listAll, listDirectory, getMine, getDirectReports, create, update, setActive };
}

module.exports = createRosterService;
