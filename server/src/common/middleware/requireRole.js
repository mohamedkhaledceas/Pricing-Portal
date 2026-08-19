/* Flat "is this actor's auth role in the allowed set" gate — the route-level
   equivalent of the plain permission functions in common/permissions.js.
   Only fits checks that don't need to know anything about the resource
   being accessed; a check like canAssignRole (which also depends on the
   *target's* role) still belongs in the service layer, not here. Must run
   after authenticate — reads req.user.role, doesn't verify identity itself. */
function requireRole(allowedRoles) {
  return function (req, res, next) {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to access this resource.' });
    }
    return next();
  };
}

module.exports = requireRole;
