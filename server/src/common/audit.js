const db = require('../db');
const logger = require('./logger');

/* Fire-and-forget, best-effort: a failed audit write is logged but must
   never fail the request it's describing — the mutation already succeeded
   by the time this is called. */
function record({ userId = null, username = null, action, entityType = null, entityId = null, details = null, ip = null }) {
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
    });
  }
}

/* Pulls actor identity (user, ip) from the request so call sites don't
   repeat that boilerplate. */
function recordFromRequest(req, action, entityType, entityId, details) {
  record({
    userId: req.user ? req.user.id : null,
    username: req.user ? req.user.username : null,
    action,
    entityType,
    entityId,
    details,
    ip: req.ip,
  });
}

module.exports = { record, recordFromRequest };
