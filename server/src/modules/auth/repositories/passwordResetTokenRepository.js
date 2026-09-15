const crypto = require('crypto');
const db = require('../../../db');

// Short-lived on purpose — unlike refresh_tokens' 30-day TTL, a leaked
// reset-email link should stop working well before anyone but the intended
// recipient could plausibly use it.
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/* Issues a brand-new reset-token row and returns the raw (unhashed) value —
   only the hash is ever persisted. Doesn't revoke this user's other
   still-pending tokens itself (see invalidateAllForUser, called separately
   by the service before this) — kept as two steps so a caller that only
   wants to issue, not also invalidate, still can. */
function issue(userId) {
  const raw = generateRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(userId, tokenHash, expiresAt);
  return raw;
}

/* Returns the matching, still-valid (not used, not expired) row for a raw
   token, or null. A used or expired token is indistinguishable from an
   unknown one to the caller, same as refreshTokenRepository.findValid. */
function findValid(rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const row = db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?').get(tokenHash);
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

function markUsed(id) {
  db.prepare('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

// Called before issuing a fresh token on a new forgot-password request, so
// only the most recently requested link for a user ever works — an earlier
// email (e.g. one the user forwarded by mistake, or a stale tab) can't be
// used once a newer one exists.
function invalidateAllForUser(userId) {
  db.prepare("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL").run(userId);
}

module.exports = {
  RESET_TOKEN_TTL_MS,
  issue,
  findValid,
  markUsed,
  invalidateAllForUser,
};
