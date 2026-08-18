const crypto = require('crypto');
const db = require('../../../db');

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* Refresh tokens rotate on every use (see findValid), which means two
   requests presenting the same cookie a moment apart — e.g. two in-flight
   API calls that both hit 401 within milliseconds of each other after
   access-token expiry, or two tabs/pages sharing one refresh cookie — will
   race: the first rotates normally, the second finds its token already
   revoked. REFRESH_REUSE_GRACE_MS lets the refresh flow treat a *very
   recent* revocation as that race rather than a hard failure (see
   findRecentlyRevoked below). It does not weaken reuse detection as a
   security control — this app already doesn't do mass session revocation
   on reuse (see the comment in authService's refresh function) — it only
   avoids spuriously logging out a legitimate concurrent request. Shipped
   and verified in production before this module existed; relocated here
   unchanged. */
const REFRESH_REUSE_GRACE_MS = 15 * 1000;

function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/* Issues a brand-new refresh token row for a user (login, signup, or the
   rotation step of a successful refresh) and returns the raw (unhashed)
   value — only the hash is ever persisted. */
function issue(userId) {
  const raw = generateRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
  db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(userId, tokenHash, expiresAt);
  return raw;
}

/* Returns the matching, still-valid (not revoked, not expired) refresh_tokens
   row for a raw token, or null. A reused (already-rotated) or logged-out
   token is indistinguishable from an unknown one here on purpose — the
   caller always sees a plain "invalid" outcome. */
function findValid(rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

/* Companion to findValid for the rotation-race case: returns the row for a
   token that's already revoked but only within the last graceMs AND was
   revoked specifically by rotation (revoked_reason = 'rotated'), or null.
   The revoked_reason filter matters: logout, a password change, and an
   admin deactivating/demoting an account all revoke the same way (see
   revokeById/revokeByRaw/revokeAllForUser below) and must never be
   resurrected by this grace window — only a token that lost a legitimate
   rotation race should be.
   The recency check runs in SQL (not `new Date(row.revoked_at)` in JS)
   because SQLite's CURRENT_TIMESTAMP is UTC text with no timezone marker —
   Node's Date parser treats that "YYYY-MM-DD HH:MM:SS" shape as local time,
   which on a non-UTC host would silently misjudge the window by the host's
   UTC offset. */
function findRecentlyRevoked(rawToken, graceMs = REFRESH_REUSE_GRACE_MS) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
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

function revokeById(id, reason = 'revoked') {
  db.prepare('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE id = ?').run(reason, id);
}

function revokeByRaw(rawToken, reason = 'revoked') {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  db.prepare(
    'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE token_hash = ? AND revoked_at IS NULL'
  ).run(reason, tokenHash);
}

function revokeAllForUser(userId, reason = 'revoked') {
  db.prepare(
    'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL'
  ).run(reason, userId);
}

module.exports = {
  REFRESH_TOKEN_TTL_MS,
  issue,
  findValid,
  findRecentlyRevoked,
  revokeById,
  revokeByRaw,
  revokeAllForUser,
};
