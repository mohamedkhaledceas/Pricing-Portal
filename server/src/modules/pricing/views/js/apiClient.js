const API_BASE = '';

/* Access tokens live in frontend memory only — never localStorage, never a
   cookie (see CLAUDE.md's security rules and /employees, /commercial-lead,
   which already do this correctly). This module-scoped variable is lost on
   every full page reload by design; main.js's boot sequence re-derives it
   via a silent refresh against the httpOnly refresh cookie every time,
   same as every other page. getStoredAuth/setStoredAuth keep their names
   and {token, user}-or-null shape so every existing call site is unaffected
   by the storage change. */
/* One-time cleanup: every browser that used this page before this fix has
   a real access token sitting in localStorage under this key. Nothing here
   reads it anymore, but leaving it in place would mean it just sits there
   exposed until it naturally expires — purge it outright instead. */
try { localStorage.removeItem('pricingPortalAuth'); } catch (err) { /* ignore */ }

let _memoryAuth = null;
export function getStoredAuth() {
  return _memoryAuth;
}
export function setStoredAuth(token, user) {
  _memoryAuth = (token && user) ? { token, user } : null;
}

/* A real 401 (refresh already retried and failed) means the session is
   genuinely gone — the original single-file app redirected to /login
   immediately, from wherever the 401 surfaced (not just on initial boot).
   Preserved here via an injected hook rather than importing main.js's full
   orchestration (account-menu mounting, tab routing, etc.) into this
   otherwise-generic API layer — main.js registers it once at boot. */
let onSessionExpired = null;
export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

/* One silent refresh attempt per 401, de-duplicated so several requests
   failing at once (e.g. a burst of auto-saves) only trigger a single
   refresh call rather than a stampede. */
let refreshInFlight = null;
export async function attemptSilentRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = doSilentRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function doSilentRefresh(isRetry) {
  let response;
  try {
    response = await fetch(API_BASE + '/api/auth/refresh', { method: 'POST', credentials: 'include' });
  } catch (err) {
    response = null;
  }
  if (response && response.ok) return response.json();
  /* A definitive 401 means the session really is gone. Anything else (rate
     limiting, a 5xx, a dropped connection) is more likely a transient
     hiccup than an expired session, so it gets one retry before the caller
     treats this as logged out. */
  if (isRetry || (response && response.status === 401)) return null;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return doSilentRefresh(true);
}

export async function apiRequest(path, options = {}, _isRetry = false) {
  const auth = getStoredAuth();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (auth && auth.token) headers.Authorization = 'Bearer ' + auth.token;
  const response = await fetch(API_BASE + path, { ...options, headers, credentials: 'include' });

  if (response.status === 401 && !_isRetry && path !== '/api/auth/login' && path !== '/api/auth/register') {
    const refreshed = await attemptSilentRefresh();
    if (refreshed && refreshed.token) {
      setStoredAuth(refreshed.token, refreshed.user);
      return apiRequest(path, options, true);
    }
    setStoredAuth(null, null);
    if (onSessionExpired) onSessionExpired();
    throw new Error('Your session has expired. Please log in again.');
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = (data && typeof data === 'object' && data.error) ? data.error : 'Request failed.';
    throw new Error(message);
  }
  return data;
}

/* Login/sign-up themselves happen on /login (see modules/auth/views/) —
   this page only needs to end a session; main.js sends the visitor there. */
export async function logoutFromApi() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    console.warn('Server-side logout failed (clearing local session anyway):', err.message);
  }
  setStoredAuth(null, null);
  if (onSessionExpired) onSessionExpired();
}
