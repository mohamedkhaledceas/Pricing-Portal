const path = require('path');
const Database = require('better-sqlite3');

const dbDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dbDir, 'app.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'owner'))
  );

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
`;

db.exec(schema);

module.exports = db;