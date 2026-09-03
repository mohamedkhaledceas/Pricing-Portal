const { EmployeesError } = require('../errors');
const { DEPARTMENTS, WORK_LOCATIONS } = require('../constants');
const logger = require('../../../common/logger');

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'freelancer'];

/* Manual CRUD by P&C/admin/manager/operations — v1 phasing per the plan:
   automatic ClickUp roster sync is explicitly deferred. Access to roster
   management is gated on the auth role: admin (system-level escape hatch),
   people_culture, manager (the CEO's role — full company-wide roster
   access, same as P&C), or operations. Company-wide, not scoped to a
   manager's own direct reports — unchanged behavior, just widened to
   include operations. */
function createRosterService({
  employeeRepository, employeeModel, leaveRequestRepository, employeeProfileChangeRequestRepository,
  profileChangeRequestModel, audit, roles, deleteStoredPhoto, clickupUserSync,
}) {
  // Fire-and-forget, same reasoning as clickupUserSync's own boot-time run
  // (see jobs/clickupUserSyncSchedule.js) — a ClickUp outage must never
  // block employee creation, and the caller already got their response.
  // Lets a newly-added employee's clickup_user_id populate immediately
  // instead of waiting for the next scheduled tick.
  function triggerClickupUserSync() {
    // run() already catches/logs its own known failure modes (team fetch
    // failing) — this only catches something unexpected escaping that,
    // same reasoning as clickupUserSyncSchedule.js's own runOnce().
    clickupUserSync.run().catch((error) => {
      logger.error('ClickUp user sync run failed unexpectedly.', { trigger: 'employee_created', message: error.message, stack: error.stack });
    });
  }
  function canManageRoster({ actorAuthRole }) {
    return actorAuthRole === roles.ADMIN || actorAuthRole === roles.PEOPLE_CULTURE
      || actorAuthRole === roles.MANAGER || actorAuthRole === roles.OPERATIONS;
  }

  function requireCanManageRoster({ actorAuthRole }) {
    if (!canManageRoster({ actorAuthRole })) {
      throw new EmployeesError('You do not have permission to manage the employee roster.', 403);
    }
  }

  // Same role set as canManageRoster — admin/manager/operations/P&C can all
  // flag/unflag a Team Head, matching the roster table's own toggle
  // visibility.
  function canAssignTeamHead({ actorAuthRole }) {
    return canManageRoster({ actorAuthRole });
  }

  // Reviewing a self-service change request (see updateMine) is deliberately
  // NOT the same set as canManageRoster: operations already has direct,
  // immediate roster-edit rights and doesn't need this queue at all — it's
  // only for the case where the *employee themselves* wants to change an
  // already-locked field.
  function canReviewProfileChanges({ actorAuthRole }) {
    return actorAuthRole === roles.ADMIN || actorAuthRole === roles.MANAGER || actorAuthRole === roles.PEOPLE_CULTURE;
  }

  function requireCanReviewProfileChanges({ actorAuthRole }) {
    if (!canReviewProfileChanges({ actorAuthRole })) {
      throw new EmployeesError('You do not have permission to review profile change requests.', 403);
    }
  }

  // department/work_location have no DB-level CHECK (see migration 008's
  // comment — adding one now would require a full SQLite table rebuild), so
  // this is the actual enforcement, not just the frontend <select>.
  // employment_type already has a DB CHECK (migration 007); validated again
  // here too, for a consistent error message and so every fixed-value field
  // fails the same way.
  function validateFixedFields({ department, workLocation, employmentType }) {
    if (department !== undefined && department !== null && department !== '' && !DEPARTMENTS.includes(department)) {
      throw new EmployeesError('Department must be one of the fixed team options.');
    }
    if (workLocation !== undefined && workLocation !== null && workLocation !== '' && !WORK_LOCATIONS.includes(workLocation)) {
      throw new EmployeesError('Work location must be one of the fixed options.');
    }
    if (employmentType !== undefined && employmentType !== null && employmentType !== '' && !EMPLOYMENT_TYPES.includes(employmentType)) {
      throw new EmployeesError('Employment type must be one of the fixed options.');
    }
  }

  // Self-registration/self-update only (not the general admin create/update
  // below, which lets admin/manager/operations/P&C freely reassign any
  // manager for organizational reasons) — a new hire's own choice of
  // manager is constrained to "a team head in the department I just
  // picked", matching the dependent dropdown in the signup wizard.
  function validateManagerIsTeamHeadInDepartment({ managerEmployeeId, department }) {
    const manager = employeeRepository.findById(managerEmployeeId);
    if (!manager || !manager.is_team_head) {
      throw new EmployeesError('Assigned manager must be a team head.');
    }
    if (manager.department !== department) {
      throw new EmployeesError('Assigned manager must be a team head in the same department.');
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
  // needs and nothing more (see employeeModel.toDirectoryEntry). Also
  // resolves each entry's manager to a display name/email (Teams directory
  // detail panel) — scoped to managers who are themselves in this same
  // active list, since an inactive manager has no meaningful directory
  // entry to resolve to anyway.
  function listDirectory() {
    const entries = decorateStatusList(employeeRepository.findAllActive().map(employeeModel.toDirectoryEntry));
    const byId = new Map(entries.map((e) => [e.id, e]));
    return entries.map((e) => {
      const manager = e.managerEmployeeId ? byId.get(e.managerEmployeeId) : null;
      return {
        ...e,
        managerName: manager ? `${manager.firstName} ${manager.lastName}` : null,
        managerEmail: manager ? manager.email : null,
      };
    });
  }

  // Pre-auth — used by the signup wizard's Assigned Manager dropdown before
  // any account exists (see routes/index.js). Minimal shape (id + name
  // only, via employeeModel.toTeamHeadOption) since this is reachable
  // without a token.
  function listTeamHeadsByDepartment(department) {
    if (!department || !DEPARTMENTS.includes(department)) return [];
    return employeeRepository.findTeamHeadsByDepartment(department).map(employeeModel.toTeamHeadOption);
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
    jobTitle, employmentType, joiningDate, workLocation, workingHours, workSchedule, status,
    isTeamHead, actorId, ip,
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
    validateFixedFields({ department, workLocation, employmentType });
    // No separate isTeamHead guard here — canAssignTeamHead is the same
    // role set as canManageRoster (checked via requireCanManageRoster
    // above), so a second check would be redundant. Kept as a named
    // function in case that ever diverges again.

    const created = employeeRepository.insert({
      userId, clickupUserId, department, kpiProfile, managerEmployeeId,
      jobTitle, employmentType, joiningDate, workLocation, workingHours, workSchedule, status, isTeamHead,
    });
    triggerClickupUserSync();
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
    jobTitle, employmentType, joiningDate, workLocation, workingHours, workSchedule, status,
    isTeamHead, actorId, ip,
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
    validateFixedFields({ department, workLocation, employmentType });
    // No separate isTeamHead guard here — canAssignTeamHead is the same
    // role set as canManageRoster (checked via requireCanManageRoster
    // above), so a second check would be redundant. Kept as a named
    // function in case that ever diverges again.

    const before = employeeModel.toEmployee(target);
    const updated = employeeRepository.update(targetId, {
      clickupUserId, department, kpiProfile, managerEmployeeId,
      jobTitle, employmentType, joiningDate, workLocation, workingHours, workSchedule, status, isTeamHead,
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

  // Self-service work-details update (job title, department, employment
  // type, joining date, work location, working hours/schedule, manager) —
  // same structural self-only shape as setMyPhoto: takes actorEmployee, no
  // targetId, so there's no code path to reach another employee's row.
  //
  // The first time an employee's profile fields are edited this way (i.e.
  // signup's own wizard already flipped profile_locked to true — see
  // createForSelfRegistration — so this branch really only fires for
  // employee rows that predate this feature, still unlocked), the change
  // applies immediately and locks the profile. Every edit after that
  // instead creates a pending employee_profile_change_requests row that a
  // manager/admin/P&C must approve (see approveChangeRequest) — never
  // applies straight to the employees table.
  function updateMine({
    actorEmployee, department, jobTitle, employmentType, joiningDate,
    workLocation, workingHours, workSchedule, managerEmployeeId, actorId, ip,
  }) {
    if (!actorEmployee) {
      throw new EmployeesError('You need a completed employee profile before you can edit your work details. Contact People & Culture.', 403);
    }
    validateFixedFields({ department, workLocation, employmentType });
    if (managerEmployeeId !== undefined && managerEmployeeId !== null) {
      const effectiveDepartment = department !== undefined ? department : actorEmployee.department;
      validateManagerIsTeamHeadInDepartment({ managerEmployeeId, department: effectiveDepartment });
    }

    const proposed = { department, jobTitle, employmentType, joiningDate, workLocation, workingHours, workSchedule, managerEmployeeId };
    Object.keys(proposed).forEach((key) => { if (proposed[key] === undefined) delete proposed[key]; });

    if (!actorEmployee.profileLocked) {
      const before = employeeModel.toEmployee(employeeRepository.findById(actorEmployee.id));
      const updated = employeeRepository.update(actorEmployee.id, { ...proposed, profileLocked: true });
      audit.record({
        userId: actorId,
        action: 'employee.profile_self_update',
        entityType: 'employee',
        entityId: String(actorEmployee.id),
        details: { self: true, before, after: employeeModel.toEmployee(updated) },
        ip,
      });
      return { pending: false, employee: decorateStatusOne(employeeModel.toEmployee(updated)) };
    }

    const existingPending = employeeProfileChangeRequestRepository.findPendingByEmployeeId(actorEmployee.id);
    if (existingPending) {
      throw new EmployeesError('You already have a change request awaiting approval.', 409);
    }

    // The Account Settings form always submits every field (same
    // send-everything convention as the admin roster table's Save button —
    // see roster.js's own comment on this), so without diffing against the
    // current stored value, an edit to just one field would create a
    // change request listing all seven as "changed". Only what actually
    // differs belongs in the reviewer's queue.
    const actualChanges = {};
    Object.keys(proposed).forEach((key) => {
      if (proposed[key] !== actorEmployee[key]) actualChanges[key] = proposed[key];
    });
    if (Object.keys(actualChanges).length === 0) {
      return { pending: false, employee: decorateStatusOne(employeeModel.toEmployee(employeeRepository.findById(actorEmployee.id))) };
    }

    const request = employeeProfileChangeRequestRepository.insert({ employeeId: actorEmployee.id, changes: actualChanges });
    audit.record({
      userId: actorId,
      action: 'employee.profile_change_requested',
      entityType: 'employee',
      entityId: String(actorEmployee.id),
      details: { self: true, changes: actualChanges },
      ip,
    });
    return { pending: true, changeRequest: profileChangeRequestModel.toChangeRequest(request) };
  }

  // No permission gate — this is the employee checking their own pending
  // request, not the review queue (listPendingChangeRequests below, which
  // is gated to admin/manager/P&C). Used by Account Settings to show
  // "Submitted — awaiting approval" instead of the edit form.
  function getMyPendingChangeRequest(actorEmployee) {
    if (!actorEmployee) return null;
    const row = employeeProfileChangeRequestRepository.findPendingByEmployeeId(actorEmployee.id);
    return row ? profileChangeRequestModel.toChangeRequest(row) : null;
  }

  function listPendingChangeRequests({ actorAuthRole }) {
    requireCanReviewProfileChanges({ actorAuthRole });
    return employeeProfileChangeRequestRepository.findAllPending().map(profileChangeRequestModel.toChangeRequest);
  }

  function approveChangeRequest({ actorAuthRole, requestId, actorId, ip }) {
    requireCanReviewProfileChanges({ actorAuthRole });
    const row = employeeProfileChangeRequestRepository.findById(requestId);
    if (!row || row.status !== 'pending') throw new EmployeesError('Change request not found or already decided.', 404);

    const changes = JSON.parse(row.changes);
    const before = employeeModel.toEmployee(employeeRepository.findById(row.employee_id));
    const updated = employeeRepository.update(row.employee_id, changes);
    employeeProfileChangeRequestRepository.decide(requestId, { status: 'approved', reviewedByUserId: actorId });
    audit.record({
      userId: actorId,
      action: 'employee.profile_change_approved',
      entityType: 'employee',
      entityId: String(row.employee_id),
      details: { before, after: employeeModel.toEmployee(updated), changes },
      ip,
    });
    return decorateStatusOne(employeeModel.toEmployee(updated));
  }

  function rejectChangeRequest({ actorAuthRole, requestId, decisionNote, actorId, ip }) {
    requireCanReviewProfileChanges({ actorAuthRole });
    const row = employeeProfileChangeRequestRepository.findById(requestId);
    if (!row || row.status !== 'pending') throw new EmployeesError('Change request not found or already decided.', 404);

    employeeProfileChangeRequestRepository.decide(requestId, { status: 'rejected', reviewedByUserId: actorId, decisionNote });
    audit.record({
      userId: actorId,
      action: 'employee.profile_change_rejected',
      entityType: 'employee',
      entityId: String(row.employee_id),
      details: { changes: JSON.parse(row.changes), decisionNote },
      ip,
    });
  }

  // No actorAuthRole gate — there is no actor yet, same reasoning as
  // setMyPhoto bypassing the admin gate, except here it's a brand-new
  // account mid-registration rather than an existing self-service user.
  // Called from authService.register inside the same DB transaction as the
  // users-row insert (see auth/container.js's setEmployeeProvisioner
  // wiring) — if anything here throws, the whole registration rolls back
  // and no orphaned users row is left.
  //
  // profileLocked is set true immediately: the signup wizard itself counts
  // as the one free self-service edit these fields get (see updateMine's
  // comment) — anything changed after this goes through the approval queue.
  function createForSelfRegistration({
    userId, department, jobTitle, employmentType, joiningDate,
    workLocation, workingHours, workSchedule, managerEmployeeId, actorId, ip,
  }) {
    if (!userId) throw new EmployeesError('userId is required.');
    if (employeeRepository.existsByUserId(userId)) {
      throw new EmployeesError('This account already has an employee record.', 409);
    }
    if (!jobTitle || !joiningDate || !workingHours || !workSchedule) {
      throw new EmployeesError('All work details are required.');
    }
    if (!department || !DEPARTMENTS.includes(department)) {
      throw new EmployeesError('Please choose a valid department.');
    }
    if (!employmentType || !EMPLOYMENT_TYPES.includes(employmentType)) {
      throw new EmployeesError('Please choose a valid employment type.');
    }
    if (!workLocation || !WORK_LOCATIONS.includes(workLocation)) {
      throw new EmployeesError('Please choose a valid work location.');
    }
    if (managerEmployeeId) {
      validateManagerIsTeamHeadInDepartment({ managerEmployeeId, department });
    }

    const created = employeeRepository.insert({
      userId, department, jobTitle, employmentType, joiningDate, workLocation, workingHours, workSchedule,
      managerEmployeeId: managerEmployeeId || null,
      profileLocked: true,
    });
    triggerClickupUserSync();
    audit.record({
      userId: actorId,
      action: 'employee.self_registered',
      entityType: 'employee',
      entityId: String(created.id),
      details: { self: true, after: employeeModel.toEmployee(created) },
      ip,
    });
    return decorateStatusOne(employeeModel.toEmployee(created));
  }

  return {
    canManageRoster, listAll, listDirectory, listTeamHeadsByDepartment, getMine, getDirectReports,
    create, update, setActive, setPhoto, setMyPhoto, updateMine, getMyPendingChangeRequest,
    listPendingChangeRequests, approveChangeRequest, rejectChangeRequest,
    createForSelfRegistration,
  };
}

module.exports = createRosterService;
