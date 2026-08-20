const db = require('../db');
const logger = require('./logger');

// users.uuid (migration 006) is the permanent, admin-only, per-account
// identifier — unlike correlationId (per-request) or userId (meaningful
// only inside this DB), it's what shows up in the Users view for an admin
// to copy and grep the logs with. Resolved here, not passed in by callers,
// so every existing audit.record()/recordFromRequest() call site across
// every module gets this for free.
function resolveUserUuid(userId) {
  if (!userId) return null;
  const row = db.prepare('SELECT uuid FROM users WHERE id = ?').get(userId);
  return row ? row.uuid : null;
}

/* Fire-and-forget, best-effort: a failed audit_log DB write is logged but
   must never fail the request it's describing — the mutation already
   succeeded by the time this is called. The logger.info call below is
   separate and unconditional: it mirrors every audited action (logins,
   logouts, roster/leave/role changes, etc.) into the same searchable JSON
   log files errorHandler.js writes to, tagged with the actor's UUID — so
   "an employee reports a bug" traces to one grep across logins, actions,
   and errors, not three different places. */
function record({ userId = null, username = null, action, entityType = null, entityId = null, details = null, ip = null }) {
  const userUuid = resolveUserUuid(userId);

  try {
    db.prepare(`
      INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, username, action, entityType, entityId, details ? JSON.stringify(details) : null, ip);
  } catch (error) {
    logger.error('Failed to write audit log entry', {
      action,
      entityType,
      entityId,
      error: error.message,
      userUuid,
    });
  }

  logger.info(`audit: ${action}`, { userUuid, userId, username, entityType, entityId, ip });
}

/* Pulls actor identity (user, ip) from the request so call sites don't
   repeat that boilerplate. */
function recordFromRequest(req, action, entityType, entityId, details) {
  record({
    userId: req.user ? req.user.id : null,
    username: req.user ? req.user.email : null,
    action,
    entityType,
    entityId,
    details,
    ip: req.ip,
  });
}

module.exports = { record, recordFromRequest };
