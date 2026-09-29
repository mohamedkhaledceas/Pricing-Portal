const { ROLES, ALL_ROLES } = require('./constants/roles');

const USER_MANAGER_ROLES = [ROLES.ADMIN, ROLES.CEO, ROLES.OPERATIONS];
const ASSIGNABLE_ROLES = ALL_ROLES;

/* Field-level gate — the first one in this codebase; everything else here
   is page/action-level. Governs real employee compensation data
   (employees.salary/currency/default_hours/default_utilization_pct/
   override_rate — migrations 028-029) once it's wired into the Margin
   Planner's Team & Salaries tab and Estimator. admin is included per the
   user's own instruction, explicitly "for testing purposes" — not because
   admin has an inherent business reason to see salary, same spirit as
   admin's existing blanket role-management override elsewhere in this
   file. commercial/account_management/operations/employee never see or
   edit this data; the Estimator/Capacity/Scenarios tabs must still work
   for them on computed price/margin output alone, never the underlying
   cost breakdown. */
const COMPENSATION_ROLES = [ROLES.CEO, ROLES.PEOPLE_CULTURE, ROLES.FINANCE, ROLES.ADMIN];

/* Kept as two separate functions, not one aliased to the other, even
   though they return the same thing today — the user described view and
   edit together this pass, but a future split (e.g., finance sees but
   doesn't edit) shouldn't require touching every call site, just one of
   these two bodies. */
function canViewCompensation(actorRole) {
  return COMPENSATION_ROLES.includes(actorRole);
}

function canEditCompensation(actorRole) {
  return COMPENSATION_ROLES.includes(actorRole);
}

function canManageUsers(actorRole) {
  return USER_MANAGER_ROLES.includes(actorRole);
}

/* manager/operations can promote/demote across every role except 'admin' —
   granting admin, or touching an existing admin account at all, is reserved
   for admins so "admin is only me" stays an actual guarantee, not just a
   convention a manager account could accidentally (or maliciously) break. */
function canAssignRole(actorRole, targetCurrentRole, newRole) {
  if (!canManageUsers(actorRole)) return false;
  if (actorRole === 'admin') return true;
  if (targetCurrentRole === 'admin' || newRole === 'admin') return false;
  return true;
}

/* Governs both deactivate and reactivate — same admin-shielding rule either way. */
function canModifyStatus(actorRole, targetCurrentRole) {
  if (!canManageUsers(actorRole)) return false;
  if (actorRole === 'admin') return true;
  return targetCurrentRole !== 'admin';
}

module.exports = {
  USER_MANAGER_ROLES, ASSIGNABLE_ROLES, canManageUsers, canAssignRole, canModifyStatus,
  COMPENSATION_ROLES, canViewCompensation, canEditCompensation,
};
