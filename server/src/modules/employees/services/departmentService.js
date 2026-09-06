const { EmployeesError } = require('../errors');

const MAX_LABEL_LENGTH = 60;

function slugify(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/* Manageable by the same 4 roles as the roster itself (rosterService's own
   canManageRoster — deliberately re-declared here rather than shared, same
   as that file's own canAssignTeamHead does for the identical role set;
   this codebase's convention is a small per-service copy over a shared
   cross-service helper). */
function createDepartmentService({ departmentRepository, departmentModel, audit, roles }) {
  function requireCanManage({ actorAuthRole }) {
    const allowed = actorAuthRole === roles.ADMIN || actorAuthRole === roles.PEOPLE_CULTURE
      || actorAuthRole === roles.MANAGER || actorAuthRole === roles.OPERATIONS;
    if (!allowed) {
      throw new EmployeesError('You do not have permission to manage departments.', 403);
    }
  }

  // No permission gate — every authenticated user, and the pre-auth signup
  // wizard, needs this to populate a dropdown. Department names aren't
  // sensitive (same tier as the employee directory's own no-gate policy).
  function list() {
    return departmentRepository.findAll().map(departmentModel.toDepartment);
  }

  function create({ actorAuthRole, label, actorId, ip }) {
    requireCanManage({ actorAuthRole });
    const trimmed = (label || '').trim();
    if (!trimmed) throw new EmployeesError('A department name is required.');
    if (trimmed.length > MAX_LABEL_LENGTH) {
      throw new EmployeesError(`Department name must be ${MAX_LABEL_LENGTH} characters or fewer.`);
    }
    if (departmentRepository.findByLabel(trimmed)) {
      throw new EmployeesError('A department with this name already exists.');
    }
    const code = slugify(trimmed);
    if (!code) throw new EmployeesError('Please choose a more distinct department name.');
    if (departmentRepository.findByCode(code)) {
      throw new EmployeesError('A department with a similar name already exists.');
    }

    const created = departmentRepository.insert({ code, label: trimmed });
    audit.record({
      userId: actorId,
      action: 'department.create',
      entityType: 'department',
      entityId: String(created.id),
      details: { label: trimmed, code },
      ip,
    });
    return departmentModel.toDepartment(created);
  }

  // Renames the display label only — `code` (the FK target every employee
  // row actually points to) never changes here, so this never needs to
  // touch employees.department or worry about breaking an existing
  // assignment. This replaces the old deactivate/reassign/recreate dance
  // for fixing a typo: just edit it in place.
  function update({ actorAuthRole, id, label, actorId, ip }) {
    requireCanManage({ actorAuthRole });
    const department = departmentRepository.findById(id);
    if (!department) throw new EmployeesError('Department not found.', 404);

    const trimmed = (label || '').trim();
    if (!trimmed) throw new EmployeesError('A department name is required.');
    if (trimmed.length > MAX_LABEL_LENGTH) {
      throw new EmployeesError(`Department name must be ${MAX_LABEL_LENGTH} characters or fewer.`);
    }
    const existing = departmentRepository.findByLabel(trimmed);
    if (existing && existing.id !== id) {
      throw new EmployeesError('A department with this name already exists.');
    }

    const updated = departmentRepository.updateLabel(id, trimmed);
    audit.record({
      userId: actorId,
      action: 'department.update',
      entityType: 'department',
      entityId: String(id),
      details: { before: { label: department.label }, after: { label: trimmed } },
      ip,
    });
    return departmentModel.toDepartment(updated);
  }

  return { list, create, update };
}

module.exports = createDepartmentService;
