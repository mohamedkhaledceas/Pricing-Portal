/* Durable counterpart to commercial_lead_live_cache — see
   docs/governance/business-portal-tracker.md §1/§4. The live cache is a
   disposable mirror of ClickUp's current state (upserted in place, hard-
   deleted on taskDeleted/list-drift/reconciliation — see dealRepository.js
   and clickupSyncService.js's removeFromLiveCache). commercial_lead_bucket_
   events/stage_history/quarter_snapshots already deliberately carry no FK
   to the cache for exactly this reason (they survive its deletions); this
   table extends that same principle to the deal's identity and core fields
   themselves, which nothing durable held before now.

   deal_id (ClickUp's own task id) is a plain shared key with the live
   cache, NOT a foreign key to it — this table is deliberately decoupled,
   updated by the same two pipelines (clickupSyncService's webhook handler
   and the reconciliation job) but NEVER deleted by either. client_id is
   nullable until the identity resolver (or a human) assigns it — see
   quarterMetricsService.js's buildClientIdentityResolver, which this table
   is the eventual persisted home for (that function currently recomputes
   identity live from the cache every call; this table lets that stop).

   sales_person/account_manager are captured here per-deal (a historical
   snapshot of who was on this specific deal), distinct from
   clients.account_manager (that column represents who manages the client
   relationship *today*, current and mutable) — see migration 026's
   comment for the same distinction. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS commercial_lead_deal_records (
      deal_id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT,
      name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      sales_person TEXT,
      account_manager TEXT,
      value NUMERIC,
      currency TEXT,
      clickup_created_at TEXT,
      clickup_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_cldr_client_id ON commercial_lead_deal_records(client_id);
    CREATE INDEX IF NOT EXISTS idx_cldr_list_id ON commercial_lead_deal_records(list_id);
  `);
}

module.exports = { up };
