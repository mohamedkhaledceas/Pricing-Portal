const USER_MANAGER_ROLES = ['admin', 'manager', 'operations'];
const ASSIGNABLE_ROLES = ['user', 'manager', 'operations', 'finance', 'admin'];

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

module.exports = { ASSIGNABLE_ROLES, canManageUsers, canAssignRole, canModifyStatus };
