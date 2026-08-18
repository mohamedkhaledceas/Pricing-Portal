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

/* Cairo-local calendar-quarter SQL fragment builder — extracted to its own
   module (commercialLeadQuarter.js) rather than defined here, so the same
   formula is available to commercialLeadQuarterMetrics.js and the one-time
   backfill script without a second implementation. Used by both
   commercial_lead_bucket_events.event_quarter and
   commercial_lead_live_cache.origin_quarter below. */
const { cairoQuarterExpr } = require('./commercialLeadQuarter');

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'manager', 'operations', 'finance', 'admin')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    revoked_reason TEXT,
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

  /* Mirror of each tracked ClickUp task's current state (2026 Projects,
     Active Clients — AM, Client Offboarding list) — kept fresh by webhook
     events (clickupSync.js) and corrected periodically by the
     reconciliation job. This is what page loads read from, so the portal
     never waits on a live ClickUp call. Not history — overwritten in place,
     row disappears if the task is deleted in ClickUp. */
  CREATE TABLE IF NOT EXISTS commercial_lead_live_cache (
    deal_id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    fields_json TEXT NOT NULL DEFAULT '{}',
    subtasks_json TEXT NOT NULL DEFAULT '[]',
    /* ClickUp's native "Related"/Task Relationships feature — array of other
       task IDs this one is linked to. Bidirectional in ClickUp itself (a
       link made from either side shows on both), so this is never written
       by us, only mirrored from what ClickUp already has. Used to join a
       pipeline deal to its downstream Active Clients / Offboarding task for
       the cross-list funnel. */
    linked_tasks_json TEXT NOT NULL DEFAULT '[]',
    /* ClickUp's own date_created/date_updated — when the deal actually was
       created/last edited in ClickUp. Deliberately separate from
       created_at/updated_at below (which are our own sync bookkeeping —
       when *we* first cached or last touched this row). Conflating the two
       was a real bug: a bulk backfill sets our own created_at to "now" for
       every row it touches, which made a one-time reconciliation run look
       like 196 brand-new leads in a single day. */
    clickup_created_at TEXT,
    clickup_updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_cl_live_cache_list_id ON commercial_lead_live_cache(list_id);

  /* Working state, 2026 Projects only — one row per currently-open deal,
     tracking which status it's in and since when. Used only to compute a
     duration the moment a deal leaves a stage; not itself a report. */
  CREATE TABLE IF NOT EXISTS commercial_lead_stage_tracking (
    deal_id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    current_status TEXT NOT NULL,
    entered_status_at TEXT NOT NULL,
    FOREIGN KEY(deal_id) REFERENCES commercial_lead_live_cache(deal_id) ON DELETE CASCADE
  );

  /* Permanent, append-only — one row per completed stage. Survives even if
     the deal itself is later deleted from ClickUp/live_cache. */
  CREATE TABLE IF NOT EXISTS commercial_lead_stage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id TEXT NOT NULL,
    list_id TEXT NOT NULL,
    status TEXT NOT NULL,
    entered_at TEXT NOT NULL,
    exited_at TEXT NOT NULL,
    days_in_stage REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cl_stage_history_deal_id ON commercial_lead_stage_history(deal_id);
  CREATE INDEX IF NOT EXISTS idx_cl_stage_history_status ON commercial_lead_stage_history(status);

  /* Permanent daily counts, 2026 Projects only — recomputed (upserted, not
     appended) throughout the day as events arrive, so "today" stays live
     rather than only updating once a day. dimension/value pairs cover:
     status, source, business_line, country, new_leads. */
  CREATE TABLE IF NOT EXISTS commercial_lead_daily_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    list_id TEXT NOT NULL,
    dimension TEXT NOT NULL,
    value TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(date, list_id, dimension, value)
  );

  CREATE INDEX IF NOT EXISTS idx_cl_daily_counts_date ON commercial_lead_daily_counts(date);

  /* One row per (list, status) as currently defined in ClickUp, exact hex
     color included — lets the UI badge each status the same color it has
     in ClickUp without hardcoding a guessed palette. Kept fresh by the same
     reconciliation cadence as the rest of the commercial-lead data (not a
     per-process memory cache — status definitions rarely change, and a
     durable table survives a restart instead of refetching on every boot). */
  CREATE TABLE IF NOT EXISTS commercial_lead_status_colors (
    list_id TEXT NOT NULL,
    status TEXT NOT NULL,
    color TEXT NOT NULL,
    orderindex INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (list_id, status)
  );

  /* Permanent, append-only — one row per time a deal crosses INTO a bucket
     (leads/qualified/onboarding/in_progress/won/lost, see
     commercialLeadBuckets.js), not one row per raw ClickUp status change —
     a lateral move within the same bucket (e.g. qualified -> in queue)
     writes nothing. This ledger is the single source of truth both the
     live "cohort performance" reads (docs/commercial-lead-quarterly-kpis-plan.md
     §6) and the frozen quarter-end snapshot (§8) are computed from — see
     docs/adr/0010-commercial-lead-quarterly-kpis.md. */
  CREATE TABLE IF NOT EXISTS commercial_lead_bucket_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id TEXT NOT NULL,
    list_id TEXT NOT NULL,
    bucket TEXT NOT NULL CHECK (bucket IN ('leads','qualified','onboarding','in_progress','won','lost')),
    entered_at TEXT NOT NULL,
    event_quarter TEXT GENERATED ALWAYS AS (${cairoQuarterExpr('entered_at')}) STORED,
    is_backfilled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_cl_bucket_events_deal ON commercial_lead_bucket_events(deal_id);
  CREATE INDEX IF NOT EXISTS idx_cl_bucket_events_lookup ON commercial_lead_bucket_events(list_id, bucket, event_quarter);

  /* One immutable row per (list, quarter), written once by the quarter-close
     freeze job and never updated after — "what we reported at the time".
     Deliberately holds ONLY that frozen snapshot, never a live/current
     figure for any metric: the live "as of now" view for any quarter (open
     or closed) always queries commercial_lead_bucket_events directly
     instead. See docs/adr/0010-commercial-lead-quarterly-kpis.md for why
     the two are kept separate rather than one table trying to be both. */
  CREATE TABLE IF NOT EXISTS commercial_lead_quarter_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id TEXT NOT NULL,
    quarter TEXT NOT NULL,
    cohort_size INTEGER NOT NULL,
    qualified_count INTEGER NOT NULL,
    onboarding_count INTEGER NOT NULL,
    in_progress_count INTEGER NOT NULL,
    won_count INTEGER NOT NULL,
    lost_count INTEGER NOT NULL,
    conversion_1_rate REAL,
    conversion_2_rate REAL,
    repeat_clients_completed_count INTEGER NOT NULL,
    repeat_clients_returned_count INTEGER NOT NULL,
    repeat_client_rate REAL,
    is_estimated INTEGER NOT NULL DEFAULT 0,
    frozen_at TEXT NOT NULL,
    UNIQUE(list_id, quarter)
  );
`;

db.exec(schema);

/* One-time rebuild for databases created before the email/roles rework — the
   CREATE TABLE IF NOT EXISTS above is a no-op against an existing old-shape
   `users` table (username column, role CHECK limited to 'user'/'owner'), so
   the rebuild has to happen by hand. Runs on every boot but only acts once:
   skipped as soon as the `email` column exists. SQLite can't ALTER a CHECK
   constraint in place, so this rebuilds the table rather than altering it. */
const usersColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!usersColumns.includes('email')) {
  /* better-sqlite3 enables FK enforcement by default (unlike a bare sqlite3
     CLI connection to the same file) — dropping `users` while refresh_tokens/
     audit_log still reference it fails unless enforcement is off for this
     step. PRAGMA foreign_keys can't be toggled inside a transaction, so it's
     set outside the db.transaction() call below, not within it. */
  db.pragma('foreign_keys = OFF');
  const migrateUsers = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'manager', 'operations', 'finance', 'admin')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const insert = db.prepare(`
      INSERT INTO users_migrated (id, email, first_name, last_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (@id, @email, @first_name, @last_name, @password_hash, @role, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    db.prepare('SELECT * FROM users').all().forEach((row) => {
      /* 'owner' was always exactly one account (the operator's own) — becomes
         'admin' under the new enum, and is the only row we can confidently
         backfill a real name for. */
      const wasOwner = row.role === 'owner';
      insert.run({
        id: row.id,
        email: row.username,
        first_name: wasOwner ? 'Mohamed' : '',
        last_name: wasOwner ? 'Khalid' : '',
        password_hash: row.password_hash,
        role: wasOwner ? 'admin' : row.role,
      });
    });
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_migrated RENAME TO users');
  });
  migrateUsers();
  db.pragma('foreign_keys = ON');
}

/* One-time column additions for databases created before ClickUp's own
   date_created/date_updated started being tracked separately from our own
   sync bookkeeping timestamps — CREATE TABLE IF NOT EXISTS above is a
   no-op against the already-existing commercial_lead_live_cache table, so
   these need adding by hand. Plain ADD COLUMN is enough here (no CHECK
   constraint involved, unlike the users rebuild above). */
/* table_xinfo, not table_info: PRAGMA table_info silently omits generated
   columns entirely (verified directly — origin_quarter, added below, does
   not appear in its output at all, which would have made the idempotency
   guard for that column always re-run the ALTER TABLE and crash with
   "duplicate column name" on every restart after the first). table_xinfo
   includes them (hidden: 2 for VIRTUAL) and behaves identically to
   table_info for ordinary columns, so this is a safe swap for the existing
   checks below too. */
const liveCacheColumns = db.prepare("PRAGMA table_xinfo(commercial_lead_live_cache)").all().map((c) => c.name);
if (!liveCacheColumns.includes('clickup_created_at')) {
  db.exec('ALTER TABLE commercial_lead_live_cache ADD COLUMN clickup_created_at TEXT');
}
if (!liveCacheColumns.includes('clickup_updated_at')) {
  db.exec('ALTER TABLE commercial_lead_live_cache ADD COLUMN clickup_updated_at TEXT');
}
if (!liveCacheColumns.includes('linked_tasks_json')) {
  db.exec("ALTER TABLE commercial_lead_live_cache ADD COLUMN linked_tasks_json TEXT NOT NULL DEFAULT '[]'");
}

/* origin_quarter is VIRTUAL, not STORED, and that's required rather than a
   style choice: SQLite refuses ALTER TABLE ADD COLUMN ... STORED once a
   table already has rows (verified directly against better-sqlite3 — it
   errors "cannot add a STORED column"; the same statement succeeds on an
   empty table, since STORED needs a value computed and written for every
   existing row, which ADD COLUMN doesn't do). VIRTUAL has no such
   restriction and was verified to work identically, including indexed —
   see docs/commercial-lead-quarterly-kpis-plan.md §2. */
if (!liveCacheColumns.includes('origin_quarter')) {
  db.exec(`ALTER TABLE commercial_lead_live_cache ADD COLUMN origin_quarter TEXT GENERATED ALWAYS AS (${cairoQuarterExpr('clickup_created_at')}) VIRTUAL`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_cl_live_cache_origin_quarter ON commercial_lead_live_cache(origin_quarter)');
}

/* revoked_reason distinguishes *why* a refresh token was revoked — added so
   the rotation-race grace window in auth.js's findRecentlyRevokedRefreshToken
   can only resurrect a token that was revoked by normal rotation, never one
   revoked by logout, a password change, or an admin deactivating/demoting
   the account. Those are deliberate "this session must end now" actions;
   letting a refresh call that arrives moments later still succeed would
   quietly undo them. */
const refreshTokenColumns = db.prepare("PRAGMA table_xinfo(refresh_tokens)").all().map((c) => c.name);
if (!refreshTokenColumns.includes('revoked_reason')) {
  db.exec('ALTER TABLE refresh_tokens ADD COLUMN revoked_reason TEXT');
}

module.exports = db;