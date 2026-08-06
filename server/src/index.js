require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const db = require('./db');
const {
  signToken,
  authMiddleware,
  REFRESH_COOKIE_NAME,
  issueRefreshToken,
  findValidRefreshToken,
  revokeRefreshTokenById,
  revokeRefreshTokenByRaw,
  setRefreshCookie,
  clearRefreshCookie,
} = require('./auth');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start — set it in the environment before running the server.');
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

/* Frontend and API are served from this same Express app on the same origin —
   there is no legitimate cross-origin caller, so no CORS middleware is needed
   at all (this also fixes the previous origin:true+credentials:true config,
   which reflected any origin back as allowed). */
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

class ValidationError extends Error {}

/* Replaces the old `Number(value || 0)` pattern, which silently turned any
   non-numeric input (typos, garbage strings) into 0 with no feedback. A
   provided value that isn't a valid number is now a 400, not silent data loss. */
function numOrDefault(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`"${fieldName}" must be a valid number.`);
  }
  return n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const clientHtmlPath = path.join(__dirname, '..', '..', 'margin-planner_1.html');
app.get('/', (req, res) => {
  res.sendFile(clientHtmlPath);
});

function serializeUser(row) {
  return row ? {
    id: row.id,
    username: row.username,
    role: row.role,
  } : null;
}

function serializeSettings(row) {
  const rates = row && row.rates_json ? JSON.parse(row.rates_json || '{}') : { EGP: 1 };
  return {
    company: row?.company || '',
    currency: row?.currency || 'EGP',
    display: row?.display || row?.currency || 'EGP',
    defaultHours: Number(row?.default_hours ?? 176),
    defaultUtil: Number(row?.default_util ?? 70),
    targetMargin: Number(row?.target_margin ?? 35),
    contingency: Number(row?.contingency ?? 10),
    basis: row?.basis || 'recovery',
    floorMargin: Number(row?.floor_margin ?? 15),
    rates,
    ratesDate: row?.rates_date || '',
    logo: row?.logo || null,
    logoQuote: row?.logo_quote !== 0,
  };
}

function serializeTeamMember(row) {
  return {
    id: row.id,
    name: row.name || '',
    role: row.role || '',
    salary: Number(row.salary || 0),
    extras: Number(row.extras || 0),
    hours: Number(row.hours || 176),
    util: Number(row.util || 70),
    override: row.override_value === null || row.override_value === undefined ? null : Number(row.override_value),
    cur: row.currency || 'EGP',
  };
}

function serializeExpense(row) {
  return {
    id: row.id,
    name: row.name || '',
    cat: row.category || '',
    amount: Number(row.amount || 0),
    freq: row.freq || 'month',
    cur: row.currency || 'EGP',
  };
}

function serializeProject(projectRow, lines, directCosts, scenarios, quoteLines, quoteMeta = {}) {
  const q = quoteMeta && typeof quoteMeta === 'object' ? quoteMeta : {};
  return {
    id: projectRow.id,
    name: projectRow.name || '',
    client: projectRow.client || '',
    months: Number(projectRow.months || 1),
    status: projectRow.status || 'Quoting',
    start: projectRow.start_month || '',
    cur: projectRow.currency || 'EGP',
    cont: Number(projectRow.contingency || 0),
    target: Number(projectRow.target || 35),
    price: projectRow.price === null || projectRow.price === undefined ? null : Number(projectRow.price),
    lines: (lines || []).map((row) => ({
      id: row.id,
      personId: row.person_id,
      hours: Number(row.hours || 0),
    })),
    direct: (directCosts || []).map((row) => ({
      id: row.id,
      name: row.name || '',
      amount: Number(row.amount || 0),
      cur: row.currency || 'EGP',
    })),
    scenarios: (scenarios || []).map((row) => ({
      id: row.id,
      name: row.name || '',
      hoursFactor: Number(row.hours_factor || 100),
      extra: Number(row.extra || 0),
      price: row.price === null || row.price === undefined ? null : Number(row.price),
    })),
    quote: {
      num: q.num || '',
      date: q.date || '',
      valid: Number(q.valid || 30),
      detail: q.detail || 'lump',
      disc: Number(q.disc || 0),
      vat: Number(q.vat || 0),
      scope: q.scope || '',
      terms: q.terms || '',
      lines: (quoteLines || []).map((row) => ({
        id: row.id,
        name: row.name || '',
        amount: Number(row.amount || 0),
      })),
    },
  };
}

function readCompanySettings() {
  const row = db.prepare('SELECT * FROM company_settings WHERE id = 1').get();
  return serializeSettings(row);
}

function readAppState() {
  const row = db.prepare('SELECT * FROM app_state WHERE id = 1').get();
  return {
    currentProject: row?.current_project || null,
    mode: row?.mode || 'admin',
  };
}

function readState() {
  const settings = readCompanySettings();
  const security = { pinHash: db.prepare('SELECT security_pin_hash FROM app_state WHERE id = 1').get()?.security_pin_hash || null };
  const team = db.prepare('SELECT * FROM team_members ORDER BY sort_order ASC, id ASC').all().map(serializeTeamMember);
  const expenses = db.prepare('SELECT * FROM expenses ORDER BY sort_order ASC, id ASC').all().map(serializeExpense);

  const projectRows = db.prepare('SELECT * FROM projects ORDER BY sort_order ASC, id ASC').all();
  const projects = projectRows.map((project) => {
    const lines = db.prepare('SELECT * FROM project_lines WHERE project_id = ? ORDER BY sort_order ASC, id ASC').all(project.id);
    const directCosts = db.prepare('SELECT * FROM direct_costs WHERE project_id = ? ORDER BY sort_order ASC, id ASC').all(project.id);
    const scenarios = db.prepare('SELECT * FROM scenarios WHERE project_id = ? ORDER BY sort_order ASC, id ASC').all(project.id);
    const quoteLines = db.prepare('SELECT * FROM quote_lines WHERE project_id = ? ORDER BY sort_order ASC, id ASC').all(project.id);
    let quoteMeta = {};
    try {
      quoteMeta = project.quote_json ? JSON.parse(project.quote_json || '{}') : {};
    } catch (error) {
      quoteMeta = {};
    }
    const record = serializeProject(project, lines, directCosts, scenarios, quoteLines, quoteMeta);
    const currentQuote = (() => {
      const q = quoteMeta || {};
      return {
        num: q.num || '',
        date: q.date || '',
        valid: Number(q.valid || 30),
        detail: q.detail || 'lump',
        disc: Number(q.disc || 0),
        vat: Number(q.vat || 0),
        scope: q.scope || '',
        terms: q.terms || '',
        lines: (q.lines || []).map((item) => ({
          id: item.id,
          name: item.name || '',
          amount: Number(item.amount || 0),
        })),
      };
    })();

    record.quote = currentQuote;
    return record;
  });

  return {
    settings,
    security,
    team,
    expenses,
    projects,
    ui: readAppState(),
  };
}

function upsertSettings(data = {}) {
  const settings = data.settings || {};
  const payload = {
    company: settings.company || '',
    currency: settings.currency || 'EGP',
    display: settings.display || settings.currency || 'EGP',
    default_hours: numOrDefault(settings.defaultHours, 176, 'defaultHours'),
    default_util: numOrDefault(settings.defaultUtil, 70, 'defaultUtil'),
    target_margin: numOrDefault(settings.targetMargin, 35, 'targetMargin'),
    contingency: numOrDefault(settings.contingency, 10, 'contingency'),
    basis: settings.basis || 'recovery',
    floor_margin: numOrDefault(settings.floorMargin, 15, 'floorMargin'),
    rates_json: JSON.stringify(settings.rates || { EGP: 1 }),
    rates_date: settings.ratesDate || '',
    logo: settings.logo || null,
    logo_quote: settings.logoQuote === false ? 0 : 1,
  };

  db.prepare(`
    INSERT INTO company_settings (
      id, company, currency, display, default_hours, default_util,
      target_margin, contingency, basis, floor_margin, rates_json, rates_date, logo, logo_quote
    ) VALUES (1, @company, @currency, @display, @default_hours, @default_util,
      @target_margin, @contingency, @basis, @floor_margin, @rates_json, @rates_date, @logo, @logo_quote)
    ON CONFLICT(id) DO UPDATE SET
      company = excluded.company,
      currency = excluded.currency,
      display = excluded.display,
      default_hours = excluded.default_hours,
      default_util = excluded.default_util,
      target_margin = excluded.target_margin,
      contingency = excluded.contingency,
      basis = excluded.basis,
      floor_margin = excluded.floor_margin,
      rates_json = excluded.rates_json,
      rates_date = excluded.rates_date,
      logo = excluded.logo,
      logo_quote = excluded.logo_quote
  `).run(payload);
}

function upsertAppUi(data = {}) {
  const ui = data.ui || {};
  const currentProject = ui.currentProject || null;
  const mode = ui.mode || 'admin';
  db.prepare(`
    INSERT INTO app_state (id, current_project, mode, security_pin_hash)
    VALUES (1, @current_project, @mode, @security_pin_hash)
    ON CONFLICT(id) DO UPDATE SET
      current_project = excluded.current_project,
      mode = excluded.mode,
      security_pin_hash = excluded.security_pin_hash,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    current_project: currentProject,
    mode,
    security_pin_hash: data.security && data.security.pinHash ? data.security.pinHash : null,
  });
}

function replaceTeam(data = []) {
  db.prepare('DELETE FROM team_members').run();
  const insert = db.prepare(`
    INSERT INTO team_members (id, name, role, salary, extras, hours, util, override_value, currency, sort_order)
    VALUES (@id, @name, @role, @salary, @extras, @hours, @util, @override, @currency, @sort_order)
  `);
  (data || []).forEach((member, index) => {
    insert.run({
      id: member.id,
      name: member.name || '',
      role: member.role || '',
      salary: numOrDefault(member.salary, 0, 'salary'),
      extras: numOrDefault(member.extras, 0, 'extras'),
      hours: numOrDefault(member.hours, 176, 'hours'),
      util: numOrDefault(member.util, 70, 'util'),
      override: numOrDefault(member.override, null, 'override'),
      currency: member.cur || 'EGP',
      sort_order: index,
    });
  });
}

function replaceExpenses(data = []) {
  db.prepare('DELETE FROM expenses').run();
  const insert = db.prepare(`
    INSERT INTO expenses (id, name, category, amount, freq, currency, sort_order)
    VALUES (@id, @name, @category, @amount, @freq, @currency, @sort_order)
  `);
  (data || []).forEach((expense, index) => {
    insert.run({
      id: expense.id,
      name: expense.name || '',
      category: expense.cat || '',
      amount: numOrDefault(expense.amount, 0, 'amount'),
      freq: expense.freq || 'month',
      currency: expense.cur || 'EGP',
      sort_order: index,
    });
  });
}

function replaceProjects(data = []) {
  db.prepare('DELETE FROM quote_lines').run();
  db.prepare('DELETE FROM scenarios').run();
  db.prepare('DELETE FROM direct_costs').run();
  db.prepare('DELETE FROM project_lines').run();
  db.prepare('DELETE FROM projects').run();

  const insertProject = db.prepare(`
    INSERT INTO projects (id, name, client, months, status, start_month, currency, contingency, target, price, quote_json, sort_order)
    VALUES (@id, @name, @client, @months, @status, @start_month, @currency, @contingency, @target, @price, @quote_json, @sort_order)
  `);

  const insertLine = db.prepare(`
    INSERT INTO project_lines (id, project_id, person_id, hours, sort_order)
    VALUES (@id, @project_id, @person_id, @hours, @sort_order)
  `);

  const insertDirectCost = db.prepare(`
    INSERT INTO direct_costs (id, project_id, name, amount, currency, sort_order)
    VALUES (@id, @project_id, @name, @amount, @currency, @sort_order)
  `);

  const insertScenario = db.prepare(`
    INSERT INTO scenarios (id, project_id, name, hours_factor, extra, price, sort_order)
    VALUES (@id, @project_id, @name, @hours_factor, @extra, @price, @sort_order)
  `);

  const insertQuoteLine = db.prepare(`
    INSERT INTO quote_lines (id, project_id, name, amount, sort_order)
    VALUES (@id, @project_id, @name, @amount, @sort_order)
  `);

  (data || []).forEach((project, index) => {
    insertProject.run({
      id: project.id,
      name: project.name || '',
      client: project.client || '',
      months: numOrDefault(project.months, 1, 'months'),
      status: project.status || 'Quoting',
      start_month: project.start || '',
      currency: project.cur || 'EGP',
      contingency: numOrDefault(project.cont, 0, 'cont'),
      target: numOrDefault(project.target, 35, 'target'),
      price: numOrDefault(project.price, null, 'price'),
      quote_json: JSON.stringify(project.quote || {
        num: '',
        date: '',
        valid: 30,
        detail: 'lump',
        disc: 0,
        vat: 0,
        scope: '',
        terms: '',
        lines: [],
      }),
      sort_order: index,
    });

    (project.lines || []).forEach((line, lineIndex) => {
      insertLine.run({
        id: line.id,
        project_id: project.id,
        person_id: line.personId,
        hours: numOrDefault(line.hours, 0, 'hours'),
        sort_order: lineIndex,
      });
    });

    (project.direct || []).forEach((item, itemIndex) => {
      insertDirectCost.run({
        id: item.id,
        project_id: project.id,
        name: item.name || '',
        amount: numOrDefault(item.amount, 0, 'amount'),
        currency: item.cur || 'EGP',
        sort_order: itemIndex,
      });
    });

    (project.scenarios || []).forEach((scenario, scenarioIndex) => {
      insertScenario.run({
        id: scenario.id,
        project_id: project.id,
        name: scenario.name || '',
        hours_factor: numOrDefault(scenario.hoursFactor, 100, 'hoursFactor'),
        extra: numOrDefault(scenario.extra, 0, 'extra'),
        price: numOrDefault(scenario.price, null, 'price'),
        sort_order: scenarioIndex,
      });
    });

    const quoteLinesData = project.quote && Array.isArray(project.quote.lines) ? project.quote.lines : [];
    quoteLinesData.forEach((item, itemIndex) => {
      insertQuoteLine.run({
        id: item.id,
        project_id: project.id,
        name: item.name || '',
        amount: numOrDefault(item.amount, 0, 'amount'),
        sort_order: itemIndex,
      });
    });
  });
}

function replaceWholeState(payload = {}) {
  const next = payload || {};
  const writeState = db.transaction(() => {
    upsertSettings(next);
    upsertAppUi(next);
    replaceTeam(next.team || []);
    replaceExpenses(next.expenses || []);
    replaceProjects(next.projects || []);
  });
  writeState();
}

function buildStateResponse() {
  return readState();
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'pricing-portal-server' });
});

/* Owner/admin accounts are still created the existing way — via an operator
   running `node src/create-user.js <email> <password> owner` (e.g. through
   Render's Shell) — this endpoint only ever creates standard `user` accounts. */
app.post('/api/auth/register', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(normalizedEmail, passwordHash, 'user');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);

  const refreshToken = issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);
  return res.status(201).json({
    token: signToken(user),
    user: serializeUser(user),
  });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};

  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'Username is required.' });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const refreshToken = issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);
  return res.json({
    token: signToken(user),
    user: serializeUser(user),
  });
});

app.post('/api/auth/refresh', authLimiter, (req, res) => {
  const rawToken = req.cookies ? req.cookies[REFRESH_COOKIE_NAME] : null;
  const tokenRow = findValidRefreshToken(rawToken);
  if (!tokenRow) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(tokenRow.user_id);
  if (!user) {
    revokeRefreshTokenById(tokenRow.id);
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }

  /* Simple rotation: the old refresh token is invalidated and a new one issued
     on every use. A reused (already-rotated) or previously logged-out token
     fails the findValidRefreshToken() lookup above — it does not trigger a
     mass revocation of the user's other sessions, which would be more than
     this internal application needs. */
  revokeRefreshTokenById(tokenRow.id);
  const newRefreshToken = issueRefreshToken(user.id);
  setRefreshCookie(res, newRefreshToken);

  return res.json({
    token: signToken(user),
    user: serializeUser(user),
  });
});

app.post('/api/auth/logout', (req, res) => {
  const rawToken = req.cookies ? req.cookies[REFRESH_COOKIE_NAME] : null;
  revokeRefreshTokenByRaw(rawToken);
  clearRefreshCookie(res);
  return res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  return res.json({ user: serializeUser(user) });
});

app.get('/api/admin-only', authMiddleware, (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required.' });
  }

  return res.json({ ok: true, message: 'Owner route access granted.' });
});

app.get('/api/settings', authMiddleware, (req, res) => {
  res.json({ settings: readCompanySettings() });
});

app.put('/api/settings', authMiddleware, (req, res) => {
  const settings = req.body || {};
  const current = readCompanySettings();
  const next = { ...current, ...settings };
  upsertSettings({ settings: next });
  res.json({ settings: readCompanySettings() });
});

app.get('/api/team', authMiddleware, (req, res) => {
  res.json({ team: readState().team });
});

app.post('/api/team', authMiddleware, (req, res) => {
  const data = req.body || {};
  const next = readState();
  next.team = [...next.team, {
    id: data.id || `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: data.name || '',
    role: data.role || '',
    salary: numOrDefault(data.salary, 0, 'salary'),
    extras: numOrDefault(data.extras, 0, 'extras'),
    hours: numOrDefault(data.hours, 176, 'hours'),
    util: numOrDefault(data.util, 70, 'util'),
    override: numOrDefault(data.override, null, 'override'),
    cur: data.cur || 'EGP',
  }];
  replaceWholeState(next);
  res.status(201).json({ team: readState().team });
});

app.put('/api/team/:id', authMiddleware, (req, res) => {
  const next = readState();
  const index = next.team.findIndex((member) => member.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Team member not found.' });
  }
  next.team[index] = { ...next.team[index], ...req.body };
  replaceWholeState(next);
  return res.json({ team: readState().team });
});

app.delete('/api/team/:id', authMiddleware, (req, res) => {
  const next = readState();
  next.team = next.team.filter((member) => member.id !== req.params.id);
  next.projects = (next.projects || []).map((project) => ({
    ...project,
    lines: (project.lines || []).filter((line) => line.personId !== req.params.id),
  }));
  replaceWholeState(next);
  return res.json({ team: readState().team });
});

app.get('/api/expenses', authMiddleware, (req, res) => {
  res.json({ expenses: readState().expenses });
});

app.post('/api/expenses', authMiddleware, (req, res) => {
  const data = req.body || {};
  const next = readState();
  next.expenses = [...next.expenses, {
    id: data.id || `expense-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: data.name || '',
    cat: data.cat || '',
    amount: numOrDefault(data.amount, 0, 'amount'),
    freq: data.freq || 'month',
    cur: data.cur || 'EGP',
  }];
  replaceWholeState(next);
  return res.status(201).json({ expenses: readState().expenses });
});

app.put('/api/expenses/:id', authMiddleware, (req, res) => {
  const next = readState();
  const index = next.expenses.findIndex((item) => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Expense not found.' });
  }
  next.expenses[index] = { ...next.expenses[index], ...req.body };
  replaceWholeState(next);
  return res.json({ expenses: readState().expenses });
});

app.delete('/api/expenses/:id', authMiddleware, (req, res) => {
  const next = readState();
  next.expenses = next.expenses.filter((item) => item.id !== req.params.id);
  replaceWholeState(next);
  return res.json({ expenses: readState().expenses });
});

app.get('/api/projects', authMiddleware, (req, res) => {
  res.json({ projects: readState().projects });
});

app.post('/api/projects', authMiddleware, (req, res) => {
  const payload = req.body || {};
  const next = readState();
  const newProject = {
    id: payload.id || `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: payload.name || 'New project',
    client: payload.client || '',
    months: numOrDefault(payload.months, 1, 'months'),
    status: payload.status || 'Quoting',
    start: payload.start || '',
    cur: payload.cur || 'EGP',
    cont: numOrDefault(payload.cont, 10, 'cont'),
    target: numOrDefault(payload.target, 35, 'target'),
    price: numOrDefault(payload.price, null, 'price'),
    lines: Array.isArray(payload.lines) ? payload.lines : [],
    direct: Array.isArray(payload.direct) ? payload.direct : [],
    scenarios: Array.isArray(payload.scenarios) ? payload.scenarios : [],
    quote: payload.quote || { num: '', date: '', valid: 30, detail: 'lump', disc: 0, vat: 0, scope: '', terms: '', lines: [] },
  };
  next.projects = [...next.projects, newProject];
  next.ui.currentProject = newProject.id;
  replaceWholeState(next);
  return res.status(201).json({ project: readState().projects.find((item) => item.id === newProject.id) });
});

app.put('/api/projects/:id', authMiddleware, (req, res) => {
  const next = readState();
  const index = next.projects.findIndex((project) => project.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Project not found.' });
  }
  next.projects[index] = { ...next.projects[index], ...req.body };
  replaceWholeState(next);
  return res.json({ project: readState().projects.find((project) => project.id === req.params.id) });
});

app.delete('/api/projects/:id', authMiddleware, (req, res) => {
  const next = readState();
  next.projects = next.projects.filter((project) => project.id !== req.params.id);
  if (next.ui.currentProject === req.params.id) {
    next.ui.currentProject = next.projects[0]?.id || null;
  }
  replaceWholeState(next);
  return res.json({ projects: readState().projects });
});

app.post('/api/projects/:projectId/lines', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const payload = req.body || {};
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const line = {
    id: payload.id || `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    personId: payload.personId || null,
    hours: numOrDefault(payload.hours, 0, 'hours'),
  };
  project.lines = [...(project.lines || []), line];
  replaceWholeState(next);
  return res.status(201).json({ line: readState().projects.find((item) => item.id === projectId)?.lines.find((entry) => entry.id === line.id) });
});

app.put('/api/projects/:projectId/lines/:id', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const index = (project.lines || []).findIndex((line) => line.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Project line not found.' });
  project.lines[index] = { ...project.lines[index], ...req.body };
  replaceWholeState(next);
  return res.json({ line: readState().projects.find((item) => item.id === projectId)?.lines.find((entry) => entry.id === req.params.id) });
});

app.delete('/api/projects/:projectId/lines/:id', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  project.lines = (project.lines || []).filter((line) => line.id !== req.params.id);
  replaceWholeState(next);
  return res.json({ lines: readState().projects.find((item) => item.id === projectId)?.lines || [] });
});

app.post('/api/projects/:projectId/direct-costs', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const payload = req.body || {};
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const direct = {
    id: payload.id || `dc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: payload.name || '',
    amount: numOrDefault(payload.amount, 0, 'amount'),
    cur: payload.cur || 'EGP',
  };
  project.direct = [...(project.direct || []), direct];
  replaceWholeState(next);
  return res.status(201).json({ direct: readState().projects.find((item) => item.id === projectId)?.direct.find((entry) => entry.id === direct.id) });
});

app.put('/api/projects/:projectId/direct-costs/:id', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const index = (project.direct || []).findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Direct cost not found.' });
  project.direct[index] = { ...project.direct[index], ...req.body };
  replaceWholeState(next);
  return res.json({ direct: readState().projects.find((item) => item.id === projectId)?.direct.find((entry) => entry.id === req.params.id) });
});

app.delete('/api/projects/:projectId/direct-costs/:id', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  project.direct = (project.direct || []).filter((item) => item.id !== req.params.id);
  replaceWholeState(next);
  return res.json({ direct: readState().projects.find((item) => item.id === projectId)?.direct || [] });
});

app.post('/api/projects/:projectId/scenarios', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const payload = req.body || {};
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const scenario = {
    id: payload.id || `scen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: payload.name || 'New scenario',
    hoursFactor: numOrDefault(payload.hoursFactor, 100, 'hoursFactor'),
    extra: numOrDefault(payload.extra, 0, 'extra'),
    price: numOrDefault(payload.price, null, 'price'),
  };
  project.scenarios = [...(project.scenarios || []), scenario];
  replaceWholeState(next);
  return res.status(201).json({ scenario: readState().projects.find((item) => item.id === projectId)?.scenarios.find((entry) => entry.id === scenario.id) });
});

app.put('/api/projects/:projectId/scenarios/:id', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const index = (project.scenarios || []).findIndex((scenario) => scenario.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Scenario not found.' });
  project.scenarios[index] = { ...project.scenarios[index], ...req.body };
  replaceWholeState(next);
  return res.json({ scenario: readState().projects.find((item) => item.id === projectId)?.scenarios.find((entry) => entry.id === req.params.id) });
});

app.delete('/api/projects/:projectId/scenarios/:id', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  project.scenarios = (project.scenarios || []).filter((scenario) => scenario.id !== req.params.id);
  replaceWholeState(next);
  return res.json({ scenarios: readState().projects.find((item) => item.id === projectId)?.scenarios || [] });
});

app.post('/api/projects/:projectId/quote-lines', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const payload = req.body || {};
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  project.quote = project.quote || { num: '', date: '', valid: 30, detail: 'lump', disc: 0, vat: 0, scope: '', terms: '', lines: [] };
  const line = {
    id: payload.id || `ql-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: payload.name || '',
    amount: numOrDefault(payload.amount, 0, 'amount'),
  };
  /* The frontend also re-sends the whole quote object (including `lines`) on
     every edit to num/date/valid/detail/disc/vat/scope/terms, to avoid the
     shallow-merge on PUT /api/projects/:id wiping the lines array — which
     means this line can already exist by the time this dedicated create call
     runs. Upsert by id instead of blindly appending, or a same-id repeat
     crashes on the quote_lines primary key. */
  project.quote.lines = project.quote.lines || [];
  const existingIndex = project.quote.lines.findIndex((item) => item.id === line.id);
  if (existingIndex === -1) {
    project.quote.lines.push(line);
  } else {
    project.quote.lines[existingIndex] = { ...project.quote.lines[existingIndex], ...line };
  }
  replaceWholeState(next);
  return res.status(201).json({ line: readState().projects.find((item) => item.id === projectId)?.quote?.lines.find((entry) => entry.id === line.id) });
});

app.put('/api/projects/:projectId/quote-lines/:id', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  project.quote = project.quote || { num: '', date: '', valid: 30, detail: 'lump', disc: 0, vat: 0, scope: '', terms: '', lines: [] };
  const index = (project.quote.lines || []).findIndex((line) => line.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Quote line not found.' });
  project.quote.lines[index] = { ...project.quote.lines[index], ...req.body };
  replaceWholeState(next);
  return res.json({ line: readState().projects.find((item) => item.id === projectId)?.quote?.lines.find((entry) => entry.id === req.params.id) });
});

app.delete('/api/projects/:projectId/quote-lines/:id', authMiddleware, (req, res) => {
  const projectId = req.params.projectId;
  const next = readState();
  const project = next.projects.find((item) => item.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  project.quote = project.quote || { num: '', date: '', valid: 30, detail: 'lump', disc: 0, vat: 0, scope: '', terms: '', lines: [] };
  project.quote.lines = (project.quote.lines || []).filter((line) => line.id !== req.params.id);
  replaceWholeState(next);
  return res.json({ lines: readState().projects.find((item) => item.id === projectId)?.quote?.lines || [] });
});

app.get('/api/state', authMiddleware, (req, res) => {
  res.json(buildStateResponse());
});

app.put('/api/state', authMiddleware, (req, res) => {
  return res.status(405).json({
    error: 'Use granular resource endpoints instead of PUT /api/state. Full-state overwrites are disabled to prevent concurrent-user data loss.'
  });
});

app.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  /* express.json() throws a SyntaxError with `.status === 400` on malformed
     request bodies — previously this fell through to the generic 500 below,
     which is both misleading (it's a client error, not a server fault) and
     not what "invalid request" should look like to a caller. */
  const status = err.status || err.statusCode;
  if (status && status >= 400 && status < 500) {
    return res.status(status).json({ error: 'The request could not be understood.' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
