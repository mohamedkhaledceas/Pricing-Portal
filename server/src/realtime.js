const { Server } = require('socket.io');
const logger = require('./common/logger');

/* Attaches to the same http.Server Express already listens on — no second
   port, no second Render service. Same-origin by construction (the app has
   no other legitimate frontend), so no CORS config is needed here either,
   consistent with the rest of this app. */
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
