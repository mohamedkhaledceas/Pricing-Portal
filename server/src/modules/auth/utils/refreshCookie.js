/* Cookie read/write is an HTTP-layer concern (touches req/res directly), so
   this lives alongside the controllers that use it rather than in a
   service or repository. REFRESH_TOKEN_TTL_MS is imported from the
   repository, not redefined here, so the cookie's maxAge and the DB row's
   expires_at can never silently drift apart. */
const config = require('../../../config');
const { REFRESH_TOKEN_TTL_MS } = require('../repositories/refreshTokenRepository');

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_BASE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProduction,
  path: '/api/auth',
};

function setRefreshCookie(res, rawToken) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, { ...REFRESH_COOKIE_BASE_OPTIONS, maxAge: REFRESH_TOKEN_TTL_MS });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_BASE_OPTIONS);
}

function readRefreshCookie(req) {
  return req.cookies ? req.cookies[REFRESH_COOKIE_NAME] : null;
}

module.exports = { REFRESH_COOKIE_NAME, setRefreshCookie, clearRefreshCookie, readRefreshCookie };
