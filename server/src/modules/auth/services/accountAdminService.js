const { AuthError } = require('../errors');

/* Kept as a separate service from authService even though both touch
   `users`: "verify my own login" and "an admin managing someone else's
   account" are different concerns that happen to share a table, not the
   same concern. */
function createAccountAdminService({
  userRepository,
  refreshTokenRepository,
  userModel,
  audit,
  permissions,
  roles,
}) {
  const { canManageUsers, canAssignRole, canModifyStatus, assignableRoles } = permissions;

  function listUsers({ actorRole }) {
    if (!canManageUsers(actorRole)) {
      throw new AuthError('You do not have permission to view accounts.', 403);
    }
    // uuid is withheld from the response entirely for non-admin roles
    // (manager/operations can still manage accounts via canManageUsers,
    // but the support-tracing UUID is admin-only) — server-side, not a
    // frontend display toggle.
    const includeUuid = actorRole === roles.ADMIN;
    return userRepository.listAll().map((row) => userModel.toAccount(row, { includeUuid }));
  }

  function changeRole({ actorId, actorRole, targetId, role, ip }) {
    if (!canManageUsers(actorRole)) {
      throw new AuthError('You do not have permission to manage accounts.', 403);
    }
    if (!assignableRoles.includes(role)) {
      throw new AuthError(`Role must be one of: ${assignableRoles.join(', ')}.`);
    }
    if (targetId === actorId) {
      throw new AuthError('You cannot change your own role.');
    }

    const target = userRepository.findById(targetId);
    if (!target) throw new AuthError('Account not found.', 404);
    if (!canAssignRole(actorRole, target.role, role)) {
      throw new AuthError('You do not have permission to assign that role.', 403);
    }
    /* Given the self-change block above and canAssignRole (only an admin can
       touch an admin account) above that, reaching this point with only one
       active admin already implies the actor IS that admin acting on
       someone else — impossible. Kept anyway as a defense-in-depth
       invariant check, in case either of those two guards is ever weakened
       by a future change without this one being revisited. */
    if (target.role === roles.ADMIN && role !== roles.ADMIN && userRepository.countActiveAdmins() <= 1) {
      throw new AuthError('At least one active admin account must remain.');
    }

    const updated = userRepository.updateRole(targetId, role);
    audit.record({
      userId: actorId,
      action: 'user.role_change',
      entityType: 'user',
      entityId: String(targetId),
      details: { before: { role: target.role }, after: { role } },
      ip,
    });
    return userModel.toAccount(updated);
  }

  function deactivate({ actorId, actorRole, targetId, ip, transaction }) {
    if (!canManageUsers(actorRole)) {
      throw new AuthError('You do not have permission to manage accounts.', 403);
    }
    if (targetId === actorId) {
      throw new AuthError('You cannot deactivate your own account.');
    }

    const target = userRepository.findById(targetId);
    if (!target) throw new AuthError('Account not found.', 404);
    if (!canModifyStatus(actorRole, target.role)) {
      throw new AuthError('You do not have permission to deactivate that account.', 403);
    }
    if (!target.is_active) throw new AuthError('That account is already deactivated.');
    // Same defense-in-depth invariant as changeRole above.
    if (target.role === roles.ADMIN && userRepository.countActiveAdmins() <= 1) {
      throw new AuthError('At least one active admin account must remain.');
    }

    transaction(() => {
      userRepository.setActive(targetId, false);
      refreshTokenRepository.revokeAllForUser(targetId, 'account_deactivated');
    });

    audit.record({
      userId: actorId,
      action: 'user.deactivate',
      entityType: 'user',
      entityId: String(targetId),
      details: { before: { isActive: true }, after: { isActive: false } },
      ip,
    });
    return userModel.toAccount(userRepository.findById(targetId));
  }

  function reactivate({ actorId, actorRole, targetId, ip }) {
    if (!canManageUsers(actorRole)) {
      throw new AuthError('You do not have permission to manage accounts.', 403);
    }

    const target = userRepository.findById(targetId);
    if (!target) throw new AuthError('Account not found.', 404);
    if (!canModifyStatus(actorRole, target.role)) {
      throw new AuthError('You do not have permission to reactivate that account.', 403);
    }
    if (target.is_active) throw new AuthError('That account is already active.');

    const updated = userRepository.setActive(targetId, true);
    audit.record({
      userId: actorId,
      action: 'user.reactivate',
      entityType: 'user',
      entityId: String(targetId),
      details: { before: { isActive: false }, after: { isActive: true } },
      ip,
    });
    return userModel.toAccount(updated);
  }

  return { listUsers, changeRole, deactivate, reactivate };
}

module.exports = createAccountAdminService;
