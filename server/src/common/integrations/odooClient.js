/* The one place the Odoo API key is used (docs/adr/0013). Read-only by
   construction: only searchRead and searchCount are exported — no generic
   call(), no create/write/unlink — because the key belongs to a personal
   Odoo account with full permissions, not a scoped integration user.
   Writing to Odoo needs a new ADR, not a new export here.

   Every call requires an explicit companyIds list: JSON-2 otherwise returns
   all companies the account can see mixed together (Ceas Comm, FZE, Learn
   With Marie), which would silently blend entities. */
const config = require('../../config');
const { AppError } = require('../errors');
const logger = require('../logger');

const REQUEST_TIMEOUT_MS = 30000;

function assertConfigured() {
  if (!config.odooUrl || !config.odooDb || !config.odooApiKey) {
    throw new AppError('Odoo integration is not configured — set ODOO_URL, ODOO_DB and ODOO_API_KEY.', 500);
  }
}

function assertCompanyIds(companyIds) {
  if (!Array.isArray(companyIds) || companyIds.length === 0 || !companyIds.every(Number.isInteger)) {
    throw new AppError('Odoo request needs an explicit, non-empty list of integer company IDs.', 500);
  }
}

/* Odoo Online answers 429 when called too fast. The request was not
   processed, so wait (Retry-After when sent, else 5 s × attempt, at most a
   minute) and retry up to 3 times. */
const MAX_RATE_LIMIT_RETRIES = 3;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function odooRequest(model, method, params, companyIds, attempt = 0) {
  assertConfigured();
  assertCompanyIds(companyIds);

  let res;
  try {
    res = await fetch(`${config.odooUrl}/json/2/${model}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `bearer ${config.odooApiKey}`,
        'X-Odoo-Database': config.odooDb,
      },
      body: JSON.stringify({ ...params, context: { allowed_company_ids: companyIds } }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppError(`Odoo request failed on ${model}/${method}: ${error.message}`, 502);
  }

  if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Math.min(60000, retryAfter > 0 ? retryAfter * 1000 : 5000 * (attempt + 1));
    logger.warn('Odoo rate limit reached — retrying.', { model, method, attempt: attempt + 1, waitMs: wait });
    await sleep(wait);
    return odooRequest(model, method, params, companyIds, attempt + 1);
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError(`Odoo returned a non-JSON response (${res.status}) on ${model}/${method}.`, 502);
  }

  if (!res.ok) {
    // Odoo's error body carries a full server traceback in `debug` — only
    // the exception name and message are kept.
    const reason = body && body.message ? `${body.name || 'Error'}: ${body.message}` : 'unknown error';
    throw new AppError(`Odoo API error (${res.status}) on ${model}/${method}: ${reason}`, 502);
  }
  return body;
}

function searchRead(model, { domain = [], fields, order, limit, offset, companyIds }) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new AppError(`Odoo searchRead on ${model} needs an explicit field list.`, 500);
  }
  return odooRequest(model, 'search_read', { domain, fields, order, limit, offset }, companyIds);
}

function searchCount(model, { domain = [], companyIds }) {
  return odooRequest(model, 'search_count', { domain }, companyIds);
}

module.exports = { searchRead, searchCount };
