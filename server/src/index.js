require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const authModule = require('./modules/auth');
const management = require('./modules/management');
const { router: employeesRouter, provisionSelfRegisteredEmployee, employeePhotoUploadDir, kpiClickupWebhookRouter } = require('./modules/employees');
const pricing = require('./modules/pricing');

/* Wires the signup wizard's employee-profile creation into auth's register
   flow without either module importing the other's internals — see
   auth/container.js's setEmployeeProvisioner and employees/container.js's
   provisionSelfRegisteredEmployee. Must run before the server starts
   accepting requests (it does, since this whole file runs synchronously
   before httpServer.listen at the bottom). */
authModule.setEmployeeProvisioner(provisionSelfRegisteredEmployee);
const { router: authRouter, authenticate: authMiddleware } = authModule;
const logger = require('./common/logger');
const correlationId = require('./common/correlationId');
const errorHandler = require('./common/errorHandler');
const notFoundHandler = require('./common/notFoundHandler');
const { initRealtime } = require('./common/realtime');
const requireRole = require('./common/middleware/requireRole');
const { USER_MANAGER_ROLES } = require('./common/permissions');

/* The Margin Planner's own API previously checked authMiddleware only —
   any authenticated user of any role could read/write salary and cost
   data. That never matched intent: modules/employees/views/js/main.js
   already only shows the "Margin Planner" nav link to
   MARGIN_PLANNER_ROLES = ['manager','operations','admin'], and the
   Planner's own client-side "Team (BD) view" PIN toggle is explicitly
   documented in-app as UI-only, not a security boundary. This enforces
   server-side what was already the intended access list, using the same
   USER_MANAGER_ROLES set (admin/manager/operations) commercial-leads
   already gates its own user-management endpoints with. */
const requirePlannerAccess = requireRole(USER_MANAGER_ROLES);

if (!process.env.JWT_SECRET) {
  logger.error('FATAL: JWT_SECRET is not set. Refusing to start — set it in the environment before running the server.');
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

/* Render (and most PaaS hosts) sit the app behind a reverse proxy — without
   this, req.ip resolves to the proxy's address for every request, which
   silently breaks both express-rate-limit's per-client accounting and the
   IP recorded on every audit log entry below. */
app.set('trust proxy', 1);

/* Frontend and API are served from this same Express app on the same origin —
   there is no legitimate cross-origin caller, so no CORS middleware is needed
   at all (this also fixes the previous origin:true+credentials:true config,
   which reflected any origin back as allowed). */
/* Must run before express.json() — a malformed request body makes body-parser
   skip straight to the error handler, bypassing any middleware mounted after
   it, which would otherwise leave that error's log entry without one. */
app.use(correlationId);

/* Mounted before the global express.json() below on purpose — it carries
   its own express.raw() parser so the exact bytes ClickUp sent are still
   available for HMAC signature verification. By the time a request reaches
   express.json(), the raw body is gone. */
app.use('/api/clickup/webhook', management.webhookRouter);

/* Same reasoning, a separate registration — see kpiClickupWebhookController
   and docs/adr/0012 addendum for why this is its own team-wide webhook
   rather than reusing commercial-leads' folder-scoped one. */
app.use('/api/employees/kpi/clickup-webhook', kpiClickupWebhookRouter);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

/* '/' is the landing page for every authenticated role — employees included
   — and always resolves to the Employees module. Margin planner moved to
   /planner (still linked from Employees' own header for manager/operations/
   admin, see modules/employees/views/js/main.js). /employees is kept only
   as a redirect to '/' so there's one canonical URL for this content. */
const employeesHtmlPath = path.join(__dirname, 'modules', 'employees', 'views', 'index.html');
app.get('/', (req, res) => {
  res.sendFile(employeesHtmlPath);
});
app.get('/employees', (req, res) => {
  res.redirect('/');
});
app.use('/employees', express.static(path.join(__dirname, 'modules', 'employees', 'views')));

/* Margin Planner — relocated into modules/pricing/views/ with full
   ES-module layering (see that module's views/js/*.js), matching the
   pattern every other frontend in this app already uses. Was a single
   ~2,779-line self-contained file (margin-planner_1.html) until this
   migration; see docs/governance/implementation-tracker.md's 2026-09-21/22
   entries for the full record. */
const plannerHtmlPath = path.join(__dirname, 'modules', 'pricing', 'views', 'index.html');
app.get('/planner', (req, res) => {
  res.sendFile(plannerHtmlPath);
});
app.use('/planner', express.static(path.join(__dirname, 'modules', 'pricing', 'views')));

/* Relocated from the old repo-root commercial-lead.html into the module
   that now owns it. */
const commercialLeadHtmlPath = path.join(__dirname, 'modules', 'management', 'commercial-leads', 'views', 'index.html');
app.get('/commercial-lead', (req, res) => {
  res.sendFile(commercialLeadHtmlPath);
});
app.use('/commercial-lead', express.static(path.join(__dirname, 'modules', 'management', 'commercial-leads', 'views')));

/* CEO dashboard — manager-role-only, see modules/management/ceo-dashboard/. */
const ceoDashboardHtmlPath = path.join(__dirname, 'modules', 'management', 'ceo-dashboard', 'views', 'index.html');
app.get('/ceo', (req, res) => {
  res.sendFile(ceoDashboardHtmlPath);
});
app.use('/ceo', express.static(path.join(__dirname, 'modules', 'management', 'ceo-dashboard', 'views')));

/* /login — the one place auth (sign in / sign up) lives. Every other page
   redirects here when a silent refresh fails; on success this page's own
   JS redirects to '/' and lets the destination page pull a fresh access
   token into its own memory (see modules/auth/views/js/main.js). */
const loginHtmlPath = path.join(__dirname, 'modules', 'auth', 'views', 'index.html');
app.get('/login', (req, res) => {
  res.sendFile(loginHtmlPath);
});
app.use('/login', express.static(path.join(__dirname, 'modules', 'auth', 'views')));

/* Employee profile photos — served from wherever photoUpload.js actually
   wrote them (server/public/uploads/employees locally, or under DB_DIR's
   persistent disk on Render), which is no longer necessarily inside
   server/public/, so it needs its own mount rather than relying on the
   generic public static below. */
app.use('/uploads/employees', express.static(employeePhotoUploadDir));

/* Shared static assets (currently just the two logo variants) — extracted
   from margin-planner_1.html's previously-inline base64 constants so both
   frontends reference the same file instead of each embedding their own
   ~30KB copy. */
app.use(express.static(path.join(__dirname, '..', 'public')));

/* /api/auth/*, /api/me*, /api/users* — relocated into modules/auth/ with
   full controller/service/repository/model layering (see that module's
   container.js). Same paths, same behavior, unchanged from the caller's
   perspective. */
app.use('/api', authRouter);

/* /api/clickup/survey, /api/commercial-lead/* — relocated into
   modules/management/commercial-leads/ with full layering. Same paths,
   same behavior. */
app.use('/api', management.router);

/* /api/employees* — new module, see modules/employees/container.js. */
app.use('/api', employeesRouter);

/* /api/settings, /api/team*, /api/expenses*, /api/projects*, /api/state —
   fully relocated into modules/pricing/ (see docs/migration-plan.md M3).
   The entire legacy Margin Planner backend that used to be inline in this
   file now lives there, fully layered. */
app.use('/api', pricing.router);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'pricing-portal-server' });
});

app.use(notFoundHandler);
app.use(errorHandler);

/* http.createServer(app) instead of app.listen(...) directly — Socket.IO
   needs to attach to the same underlying HTTP server Express is using, not
   a second one, so this app and its realtime layer share one port and one
   Render service. */
const httpServer = http.createServer(app);
initRealtime(httpServer, { verifyAccessToken: authModule.verifyAccessToken });

httpServer.listen(PORT, HOST, () => {
  logger.info(`Server listening on http://${HOST}:${PORT}`);
  management.startReconciliationSchedule();
  management.scheduleQuarterFreeze();
});
