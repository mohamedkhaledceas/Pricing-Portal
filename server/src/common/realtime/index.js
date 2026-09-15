/* Socket.IO init is app-wide infra (attaches to the one shared HTTP
   server), so it lives in common/ rather than inside commercial-leads/ —
   commercial-leads (emitClickupEvent) and employees (presence, below) both
   adopt this same broadcast() without any restructuring here. Relocated
   from the old flat realtime.js unchanged. */
const { Server } = require('socket.io');
const logger = require('../logger');

let io = null;

/* userId -> Set<socketId> — a user counts as online while they have at
   least one live socket; only broadcast the 0<->1 transitions (every
   individual tab connecting/disconnecting would be noise, and someone with
   two tabs open shouldn't flicker offline when they close just one). Plain
   in-memory Map, not persisted — correct by construction on every process
   restart (nobody has a live socket to a process that just started), and a
   presence feature has no need to survive a restart anyway. */
const onlineUserSockets = new Map();

function broadcastPresence(userId, online) {
  if (!io) return;
  io.emit('presence:change', { userId, online });
}

function isUserOnline(userId) {
  const sockets = onlineUserSockets.get(userId);
  return !!sockets && sockets.size > 0;
}

function getOnlineUserIds() {
  return new Set(onlineUserSockets.keys());
}

/* verifyAccessToken is injected (see index.js) rather than required from
   modules/auth directly — common/ must never import a module (would invert
   the established module -> common dependency direction, and ADR-0002
   already reserves minting/verifying session tokens to modules/auth
   itself). A socket identifies itself once, at connect time, with the same
   access token already in the frontend's memory for API calls (sent via
   Socket.IO's handshake `auth` option, not a query string, so it doesn't
   end up in server access logs). An invalid/expired/missing token just
   means this connection never registers as "present" — presence is a
   low-stakes display feature, not an access-control gate, so failing
   closed to "no presence" (rather than erroring the connection) is the
   right level of strictness; it doesn't need continuous re-verification
   for the lifetime of a long-lived socket either, for the same reason. */
function initRealtime(httpServer, { verifyAccessToken } = {}) {
  io = new Server(httpServer, {
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    logger.info('Socket.IO client connected', { socketId: socket.id });

    let identifiedUserId = null;
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (token && verifyAccessToken) {
      try {
        const payload = verifyAccessToken(token);
        identifiedUserId = payload.sub;
        const sockets = onlineUserSockets.get(identifiedUserId) || new Set();
        const wasOffline = sockets.size === 0;
        sockets.add(socket.id);
        onlineUserSockets.set(identifiedUserId, sockets);
        if (wasOffline) broadcastPresence(identifiedUserId, true);
      } catch (error) {
        // Invalid/expired token — this connection just never registers as present.
      }
    }

    socket.on('disconnect', () => {
      logger.info('Socket.IO client disconnected', { socketId: socket.id });
      if (identifiedUserId == null) return;
      const sockets = onlineUserSockets.get(identifiedUserId);
      if (!sockets) return;
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUserSockets.delete(identifiedUserId);
        broadcastPresence(identifiedUserId, false);
      }
    });
  });

  return io;
}

/* Broadcasts to every connected client — fine while this is a single
   internal dashboard with no per-user data segregation. Revisit (rooms,
   per-user auth on the socket) if that stops being true. */
function emitClickupEvent(payload) {
  if (!io) {
    logger.warn('emitClickupEvent called before initRealtime — dropping event.');
    return;
  }
  io.emit('clickup:event', payload);
}

module.exports = { initRealtime, emitClickupEvent, isUserOnline, getOnlineUserIds };
