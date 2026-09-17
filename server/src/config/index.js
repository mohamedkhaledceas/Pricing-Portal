require('dotenv').config();

/* The only file this pass reads process.env in for the pieces it touches
   (auth, the database connection). clickup.js/clickupReconcile.js/
   clickupWebhook.js/backup.js/seed-owner.js still read process.env directly
   for now — deliberately out of scope here, since centralizing those belongs
   with the Commercial Lead relocation pass that already has to touch every
   one of those files' require paths, not this one.

   Deliberately does NOT validate JWT_SECRET's presence here — index.js's
   existing startup check (logger.error + process.exit(1), a clean
   operator-facing message) stays the actual fail-fast gate. Throwing from
   here instead would make db.js (which only needs dbDir) transitively fail
   on a missing var it doesn't itself use, just because it now also requires
   this shared module — an awkward coupling for no real benefit over the
   check index.js already has. */

const port = Number(process.env.PORT || 3001);

module.exports = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port,
  host: process.env.HOST || '0.0.0.0',
  dbDir: process.env.DB_DIR || null, // null lets db.js fall back to its own default path
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  // The app's own public URL, used only to build links that get emailed out
  // (currently: the password-reset link) — deliberately NOT derived from
  // the incoming request's Host header (`req.get('host')`/`req.protocol`),
  // even though that's a common shortcut. `trust proxy` is enabled below in
  // index.js (required for Render), which makes Express trust
  // X-Forwarded-Host — an attacker-supplied header on the very request that
  // triggers the email. Building the link from that would let an attacker
  // put their own domain into a real password-reset email sent to someone
  // else's real inbox, with a real, working, single-use token attached
  // ("password reset poisoning" — a well-known, concretely exploitable
  // class of bug, not a theoretical one). A fixed, operator-configured
  // value has no such input path. Must be set to the real deployed origin
  // in production (see render.yaml); the localhost default only makes
  // sense for local dev.
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${port}`,
  // Resend (https://resend.com) — transactional email. resendApiKey unset
  // means the app just runs without email capability (see
  // common/integrations/resendClient.js's own fail-fast check at send time,
  // not here — same "don't throw from config" reasoning as jwtSecret above).
  // emailFrom must be an address on a domain verified in the Resend
  // dashboard (SPF/DKIM/DMARC records added there) or every send is
  // rejected regardless of the API key being valid.
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM,
});
