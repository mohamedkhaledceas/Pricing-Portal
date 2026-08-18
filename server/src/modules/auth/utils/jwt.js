/* Auth-only, per ADR-0002 — no other module should ever mint or verify a
   session token directly. */
const jwt = require('jsonwebtoken');
const config = require('../../../config');

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = { signAccessToken, verifyAccessToken };
