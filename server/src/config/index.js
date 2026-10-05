require('dotenv').config();

/* The only file this pass reads process.env in for the pieces it touches
   (auth, the database connection, the two inbound-webhook signature
   secrets). common/integrations/clickupClient.js (the outbound
   CLICKUP_API_KEY) and backup.js/seed-owner.js still read process.env
   directly for now — deliberately out of scope here; that's a wider
   refactor already tracked in docs/governance/business-portal-tracker.md,
   not something to do piecemeal alongside an unrelated change.

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
  // Inbound webhook signature secrets (HMAC verification in
  // common/integrations/clickupWebhookAuth.js) — two separate ClickUp
  // webhook registrations, see commercial-leads/controllers/
  // webhookController.js and employees/controllers/
  // kpiClickupWebhookController.js for why. Unset means that controller
  // fails closed (rejects every webhook with a 500), not a silent no-op —
  // see each controller's own check.
  clickupWebhookSecret: process.env.CLICKUP_WEBHOOK_SECRET,
  clickupKpiWebhookSecret: process.env.CLICKUP_KPI_WEBHOOK_SECRET,
  // Odoo JSON-2 API (docs/adr/0013). Key-only auth — no username needed.
  // The key belongs to a personal Odoo account (no integration seat
  // available), so it carries that person's full Odoo permissions; the
  // client that reads it (common/integrations/odooClient.js) is read-only
  // by construction for that reason. Unset means the client fails at call
  // time, not here — same "don't throw from config" reasoning as jwtSecret.
  odooUrl: process.env.ODOO_URL ? process.env.ODOO_URL.replace(/\/+$/, '') : undefined,
  odooDb: process.env.ODOO_DB,
  odooApiKey: process.env.ODOO_API_KEY,
  // Incremental Odoo sync interval (management/finance). Should divide 60
  // evenly — it's used as a */N cron minute field.
  odooSyncMinutes: Number(process.env.ODOO_SYNC_MINUTES || 15),
});
