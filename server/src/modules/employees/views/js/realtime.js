import { state } from './state.js';
import { applyPresenceChange, renderOverview } from './overview.js';

/* Same shape as commercial-leads' own realtime.js (global `io()` from the
   socket.io-client script tag, not an import — see that file's precedent).
   `auth: { token }` is Socket.IO's handshake-auth option, read server-side
   in common/realtime's connection handler — never a query string, so the
   access token doesn't end up in any server access log. */
let socket = null;

export function connectRealtime() {
  if (socket) return; // main.js only calls this once; guard anyway in case that ever changes
  socket = io({ path: '/socket.io', auth: { token: state.accessToken } });

  socket.on('presence:change', ({ userId, online }) => {
    applyPresenceChange(userId, online);
  });

  // A dropped connection (network blip, laptop sleep/wake) can miss other
  // users' presence changes while this socket was down — single-entry
  // patching via presence:change isn't enough to resync after that.
  // `socket.io.on('reconnect', ...)` (the Manager, not the socket itself)
  // fires only on an actual reconnect, never on the first connection, so
  // this doesn't double-fetch what main.js's own initial renderOverview()
  // call already does on page load.
  socket.io.on('reconnect', () => {
    if (state.mainTab === 'overview') renderOverview();
  });
}
