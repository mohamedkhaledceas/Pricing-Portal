/* Socket.IO init is app-wide infra (attaches to the one shared HTTP
   server), so it lives in common/ rather than inside commercial-leads/ —
   but commercial-leads/ is still the only feature calling emitClickupEvent
   today; a second module could adopt this same broadcast() without any
   restructuring here. Relocated from the old flat realtime.js unchanged. */
const { Server } = require('socket.io');
const logger = require('../logger');

let io = null;

function initRealtime(httpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    logger.info('Socket.IO client connected', { socketId: socket.id });
    socket.on('disconnect', () => {
      logger.info('Socket.IO client disconnected', { socketId: socket.id });
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

module.exports = { initRealtime, emitClickupEvent };
