import { state } from './state.js';

export async function apiFetch(path, options, _isRetry) {
  const res = await fetch(path, {
    ...options,
    headers: { ...(options && options.headers), Authorization: 'Bearer ' + state.accessToken },
  });
  if (res.status === 401 && !_isRetry) {
    const ok = await bootstrapAuth();
    if (ok) return apiFetch(path, options, true);
  }
  if (!res.ok) {
    // Reads the server's real `{ error }` message when there is one (see
    // employees/views/js/apiClient.js, which already does this) rather than
    // a bare status code — callers branch on `error.status` for auth vs.
    // everything-else, but still want a real message to show either way.
    let message = 'Request failed: ' + path + ' -> ' + res.status;
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch (err) {}
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

/* De-duplicated so several requests failing at once (e.g. loadAll()'s
   parallel fetches all hitting 401 right after the access token expires)
   only trigger a single refresh call rather than a stampede that races
   the server's single-use refresh-token rotation. */
let refreshInFlight = null;
export async function bootstrapAuth() {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function doRefresh(isRetry) {
  let res;
  try {
    res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
  } catch (err) {
    res = null;
  }
  if (res && res.ok) {
    const data = await res.json();
    state.accessToken = data.token;
    state.currentUser = data.user;
    return true;
  }
  /* A definitive 401 means the session really is gone. Anything else (rate
     limiting, a 5xx, a dropped connection) is more likely a transient
     hiccup than an expired session, so it gets one retry before the caller
     is shown the logged-out state. */
  if (isRetry || (res && res.status === 401)) return false;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return doRefresh(true);
}
