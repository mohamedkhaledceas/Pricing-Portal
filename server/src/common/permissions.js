const { ROLES, ALL_ROLES } = require('./constants/roles');

const USER_MANAGER_ROLES = [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATIONS];
const ASSIGNABLE_ROLES = ALL_ROLES;

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

module.exports = { USER_MANAGER_ROLES, ASSIGNABLE_ROLES, canManageUsers, canAssignRole, canModifyStatus };
