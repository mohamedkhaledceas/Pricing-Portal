/* A portal client is now a name in ClickUp's workspace-wide "Client Name"
   dropdown, identified by that option's id (decision 2026-10-05, see
   docs/governance/business-portal-tracker.md §6n). Additive only:

   - clickup_option_id: the dropdown option this client is. Unique when
     set (partial index — SQLite can't add a UNIQUE column in place). A
     rename in ClickUp keeps the id, so links survive renames.
   - kind: 'client' or 'lead'. Rows from the one-time 2026-09-27 deal
     import that never matched a dropdown name become 'lead' — hidden from
     the client book, never deleted (deal records point at them).
   - is_internal: CEAS's own dropdown entries (Ceas Comm, Ceas Comm FZE,
     Ceas Figures) — kept, but not shown as clients.
   - source: where the row came from — 'clickup' (created by the sync),
     'deal_import' (the 2026-09-27 import; every existing row, which is
     why it's the default), 'odoo' (created from an Odoo customer on the
     client-mapping page).

   clickup_client_sync_state is the dropdown sync's single status row
   (CHECK id = 1), same pattern as finance_settings.

   CHECK constraints are added with the columns (SQLite allows that on ADD
   COLUMN; every existing row takes the default, which satisfies them). */
function up(db) {
  const columns = db.prepare('PRAGMA table_info(clients)').all().map((c) => c.name);
  db.transaction(() => {
    if (!columns.includes('clickup_option_id')) {
      db.exec('ALTER TABLE clients ADD COLUMN clickup_option_id TEXT;');
    }
    if (!columns.includes('kind')) {
      db.exec("ALTER TABLE clients ADD COLUMN kind TEXT NOT NULL DEFAULT 'client' CHECK (kind IN ('client', 'lead'));");
    }
    if (!columns.includes('is_internal')) {
      db.exec('ALTER TABLE clients ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0, 1));');
    }
    if (!columns.includes('source')) {
      db.exec("ALTER TABLE clients ADD COLUMN source TEXT NOT NULL DEFAULT 'deal_import' CHECK (source IN ('clickup', 'deal_import', 'odoo'));");
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_clickup_option
        ON clients(clickup_option_id) WHERE clickup_option_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_clients_kind ON clients(kind);

      CREATE TABLE IF NOT EXISTS clickup_client_sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_attempt_at TEXT,
        last_success_at TEXT,
        last_status TEXT CHECK (last_status IN ('ok', 'error')),
        last_error TEXT,
        last_trigger TEXT
      );
    `);
  })();
}

module.exports = { up };
