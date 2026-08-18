const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');

/* Access tokens are short-lived by design — the refresh cookie is what keeps a
   session alive across a workday without the user re-entering credentials. */
const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* Refresh tokens rotate on every use (see findValidRefreshToken), which means
   two requests presenting the same cookie a moment apart — e.g. two in-flight
   API calls that both hit 401 within milliseconds of each other after access
   -token expiry, or two tabs/pages sharing one refresh cookie — will race:
   the first rotates normally, the second finds its token already revoked.
   REFRESH_REUSE_GRACE_MS lets /api/auth/refresh treat a *very recent*
   revocation as that race rather than a hard failure (see
   findRecentlyRevokedRefreshToken below). It does not weaken reuse
   detection as a security control — this app already doesn't do mass
   session revocation on reuse (see the comment in index.js's refresh route)
   — it only avoids spuriously logging out a legitimate concurrent request. */
const REFRESH_REUSE_GRACE_MS = 15 * 1000;

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_BASE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/api/auth',
};

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    }
  );
}

/* Role and active-status are re-read from the DB on every request rather than
   trusted from the JWT payload — the access token can live up to JWT_EXPIRES_IN
   (2h in production), so a deactivation or role change must take effect
   immediately, not only once the old token happens to expire. */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid token.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT id, email, role, is_active FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function generateRawRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashRefreshToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/* Issues a brand-new refresh token row for a user (login, signup, or the
   rotation step of a successful refresh) and returns the raw (unhashed)
   value — only the hash is ever persisted. */
function issueRefreshToken(userId) {
  const raw = generateRawRefreshToken();
  const tokenHash = hashRefreshToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(userId, tokenHash, expiresAt);
  return raw;
}

/* Returns the matching, still-valid (not revoked, not expired) refresh_tokens
   row for a raw token, or null. A reused (already-rotated) or logged-out
   token is indistinguishable from an unknown one here on purpose — the
   caller always sees a plain "invalid" outcome. */
function findValidRefreshToken(rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashRefreshToken(rawToken);
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

/* Companion to findValidRefreshToken for the rotation-race case: returns the
   row for a token that's already revoked but only within the last graceMs
   AND was revoked specifically by rotation (revoked_reason = 'rotated'), or
   null. Deliberately a separate function rather than a mode of
   findValidRefreshToken, since that function's "valid or null" contract is
   also relied on by /api/auth/logout, where a recently-revoked token should
   NOT be treated as still-good.
   The revoked_reason filter matters: logout, a password change, and an
   admin deactivating/demoting an account all revoke the same way (see
   revokeRefreshTokenById/revokeRefreshTokenByRaw below) and must never be
   resurrected by this grace window — only a token that lost a legitimate
   rotation race should be.
   The recency check runs in SQL (not `new Date(row.revoked_at)` in JS)
   because SQLite's CURRENT_TIMESTAMP is UTC text with no timezone marker —
   Node's Date parser treats that "YYYY-MM-DD HH:MM:SS" shape as local time,
   which on a non-UTC host would silently misjudge the window by the host's
   UTC offset. */
function findRecentlyRevokedRefreshToken(rawToken, graceMs = REFRESH_REUSE_GRACE_MS) {
  if (!rawToken) return null;
  const tokenHash = hashRefreshToken(rawToken);
  const graceSeconds = Math.ceil(graceMs / 1000);
  const row = db
    .prepare(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = ?
         AND revoked_at IS NOT NULL
         AND revoked_reason = 'rotated'
         AND revoked_at >= datetime('now', ?)`
    )
    .get(tokenHash, `-${graceSeconds} seconds`);
  return row || null;
}

function revokeRefreshTokenById(id, reason = 'revoked') {
  db.prepare('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE id = ?').run(reason, id);
}

function revokeRefreshTokenByRaw(rawToken, reason = 'revoked') {
  if (!rawToken) return;
  const tokenHash = hashRefreshToken(rawToken);
  db.prepare(
    'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE token_hash = ? AND revoked_at IS NULL'
  ).run(reason, tokenHash);
}

function setRefreshCookie(res, rawToken) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    ...REFRESH_COOKIE_BASE_OPTIONS,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_BASE_OPTIONS);
}

module.exports = {
  signToken,
  authMiddleware,
  REFRESH_COOKIE_NAME,
  issueRefreshToken,
  findValidRefreshToken,
  findRecentlyRevokedRefreshToken,
  revokeRefreshTokenById,
  revokeRefreshTokenByRaw,
  setRefreshCookie,
  clearRefreshCookie,
};
