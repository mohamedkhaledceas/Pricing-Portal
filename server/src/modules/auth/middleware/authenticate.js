/* Role and active-status are re-read from the DB on every request rather
   than trusted from the JWT payload — the access token can live up to
   JWT_EXPIRES_IN (2h in production), so a deactivation or role change must
   take effect immediately, not only once the old token happens to expire.
   Exported as a factory so other modules' routes can depend on the
   composed middleware instance (see modules/auth/index.js) without
   reaching into auth's repositories/services directly. */
function createAuthenticateMiddleware({ userRepository, verifyAccessToken }) {
  return function authenticate(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Missing or invalid token.' });
    }

    try {
      const payload = verifyAccessToken(token);
      const user = userRepository.findById(payload.sub);
      if (!user || !user.is_active) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
      }
      req.user = { id: user.id, email: user.email, role: user.role };
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
  };
}

module.exports = createAuthenticateMiddleware;
