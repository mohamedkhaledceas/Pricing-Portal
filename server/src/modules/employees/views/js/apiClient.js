import { state } from './state.js';

/* Backend convention here is the flat `{ error: string }` shape (existing
   app convention — see docs/api-guidelines.md's note that this module
   deliberately doesn't introduce a third response envelope), not the
   `{ data }/{ error: { code } }` target shape. apiFetch surfaces that
   message on the thrown Error so callers can show it directly. */
export async function apiFetch(path, options, _isRetry) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options && options.headers), Authorization: 'Bearer ' + state.accessToken },
  });
  if (res.status === 401 && !_isRetry) {
    const ok = await bootstrapAuth();
    if (ok) return apiFetch(path, options, true);
  }
  if (!res.ok) {
    let message = 'Request failed: ' + path + ' -> ' + res.status;
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch (err) {}
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

/* De-duplicated so several parallel requests hitting 401 right after the
   access token expires only trigger one refresh call, not a stampede that
   races the server's single-use refresh-token rotation — same pattern as
   Commercial Lead's apiClient.js. */
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
