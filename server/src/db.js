const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/* DB_DIR lets a persistent disk be mounted anywhere the hosting platform
   chooses (e.g. Render/Railway/Fly volumes) and pointed at explicitly,
   instead of assuming the database lives inside the deployed source tree —
   which most platforms wipe and recreate on every deploy. */
const dbDir = process.env.DB_DIR || path.join(__dirname, '..', 'data');
const dbPath = path.join(dbDir, 'app.db');

fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'owner'))
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

  CREATE TABLE IF NOT EXISTS company_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    company TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'EGP',
    display TEXT NOT NULL DEFAULT 'EGP',
    default_hours REAL NOT NULL DEFAULT 176,
    default_util REAL NOT NULL DEFAULT 70,
    target_margin REAL NOT NULL DEFAULT 35,
    contingency REAL NOT NULL DEFAULT 10,
    basis TEXT NOT NULL DEFAULT 'recovery',
    floor_margin REAL NOT NULL DEFAULT 15,
    rates_json TEXT NOT NULL DEFAULT '{}',
    rates_date TEXT NOT NULL DEFAULT '',
    logo TEXT,
    logo_quote INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    current_project TEXT,
    mode TEXT NOT NULL DEFAULT 'admin',
    security_pin_hash TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    salary REAL NOT NULL DEFAULT 0,
    extras REAL NOT NULL DEFAULT 0,
    hours REAL NOT NULL DEFAULT 176,
    util REAL NOT NULL DEFAULT 70,
    override_value REAL,
    currency TEXT NOT NULL DEFAULT 'EGP',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    freq TEXT NOT NULL DEFAULT 'month',
    currency TEXT NOT NULL DEFAULT 'EGP',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    client TEXT NOT NULL DEFAULT '',
    months REAL NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'Quoting',
    start_month TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'EGP',
    contingency REAL NOT NULL DEFAULT 10,
    target REAL NOT NULL DEFAULT 35,
    price REAL,
    quote_json TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS project_lines (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    person_id TEXT,
    hours REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS direct_costs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EGP',
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    hours_factor REAL NOT NULL DEFAULT 100,
    extra REAL NOT NULL DEFAULT 0,
    price REAL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS quote_lines (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
`;

db.exec(schema);

module.exports = db;