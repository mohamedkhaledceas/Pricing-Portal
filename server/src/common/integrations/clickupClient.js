/* The one place CLICKUP_API_KEY is read — generic authenticated request
   wrappers, shared by every module that needs ClickUp (today: Commercial
   Lead reads, Employees' leave-request sync writes; Employees' roster
   lookup, per the plan). Never called from the frontend; never returns
   the raw key. clickupGet promoted here from the old flat clickup.js
   unchanged; clickupPost/clickupPut added for Employees' ClickUp sync
   (see modules/employees/services/clickupLeaveSync.js) — same shape,
   just a body and a different HTTP method. */
const { AppError } = require('../errors');
const logger = require('../logger');

const CLICKUP_BASE = 'https://api.clickup.com/api/v2';

/* ClickUp allows 100 requests a minute per token, shared by every sync in
   this process. A 429 means the request was not processed, so it is safe
   to retry (writes included): wait until the reset time ClickUp sends
   (X-RateLimit-Reset, epoch seconds), at most a minute, and try again —
   up to MAX_RATE_LIMIT_RETRIES times before giving up as before. */
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 60 * 1000;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function rateLimitWait(res, attempt) {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const untilReset = reset ? reset * 1000 - Date.now() + 500 : 0;
  return Math.min(MAX_RATE_LIMIT_WAIT_MS, Math.max(untilReset, 5000 * (attempt + 1)));
}

async function clickupRequest(method, path, body, attempt = 0) {
  const apiKey = process.env.CLICKUP_API_KEY;
  if (!apiKey) {
    throw new AppError('ClickUp integration is not configured — set CLICKUP_API_KEY.', 500);
  }
  const res = await fetch(`${CLICKUP_BASE}${path}`, {
    method,
    headers: {
      Authorization: apiKey,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    const wait = rateLimitWait(res, attempt);
    logger.warn('ClickUp rate limit reached — retrying.', { method, path: path.split('?')[0], attempt: attempt + 1, waitMs: wait });
    await sleep(wait);
    return clickupRequest(method, path, body, attempt + 1);
  }
  if (!res.ok) {
    const responseBody = await res.text().catch(() => '');
    throw new AppError(`ClickUp API error (${res.status}) on ${method} ${path}: ${responseBody}`, 502);
  }
  if (res.status === 204) return null;
  return res.json();
}

function clickupGet(path) {
  return clickupRequest('GET', path);
}

function clickupPost(path, body) {
  return clickupRequest('POST', path, body);
}

function clickupPut(path, body) {
  return clickupRequest('PUT', path, body);
}

/* Structural survey only — space/folder/list names and IDs, not tasks or
   custom fields. Generic diagnostic tool, not tied to any one module's
   data model, so it lives alongside the low-level client rather than
   inside commercial-leads/. */
async function getWorkspaceSurvey() {
  const { teams } = await clickupGet('/team');

  return Promise.all((teams || []).map(async (team) => {
    const { spaces } = await clickupGet(`/team/${team.id}/space?archived=false`);

    const spaceSurveys = await Promise.all((spaces || []).map(async (space) => {
      const [{ folders }, { lists: folderlessLists }] = await Promise.all([
        clickupGet(`/space/${space.id}/folder?archived=false`),
        clickupGet(`/space/${space.id}/list?archived=false`),
      ]);

      return {
        id: space.id,
        name: space.name,
        folders: (folders || []).map((folder) => ({
          id: folder.id,
          name: folder.name,
          lists: (folder.lists || []).map((list) => ({ id: list.id, name: list.name })),
        })),
        folderlessLists: (folderlessLists || []).map((list) => ({ id: list.id, name: list.name })),
      };
    }));

    return { id: team.id, name: team.name, spaces: spaceSurveys };
  }));
}

module.exports = { clickupGet, clickupPost, clickupPut, getWorkspaceSurvey };
