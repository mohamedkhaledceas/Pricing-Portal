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
  if (!res.ok) throw new Error('Request failed: ' + path + ' -> ' + res.status);
  return res.json();
}

/* De-duplicated so several requests failing at once all hitting 401 right
   after the access token expires only trigger a single refresh call rather
   than a stampede that races the server's single-use refresh-token rotation. */
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
  if (isRetry || (res && res.status === 401)) return false;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return doRefresh(true);
}
