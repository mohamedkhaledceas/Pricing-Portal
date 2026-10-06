/* ClickUp delivery tasks — phase 5. Owned by modules/management/delivery.

   A read-only copy of the client-delivery space ("Ceas Comm | Kitchen"):
   every open task, and tasks closed in the last 90 days, refreshed whole
   every 15 minutes. The Control Room's Delivery page reads it — overdue
   work, work by stage, workload by person and client — so a page load
   never waits on ClickUp.

   - clickup_delivery_tasks: one row per task (subtasks included). Status
     is kept as ClickUp names it (each list has its own workflow); due and
     closed are Cairo calendar dates. client_* is the workspace-wide
     "Client Name" dropdown (migration 034's id).
   - clickup_delivery_task_assignees: who a task is assigned to (many).
   - clickup_delivery_sync_state: the sync's single status row (CHECK
     id = 1), same pattern as clickup_client_sync_state.

   Caches of ClickUp: replaced every run, nothing outside may FK to them. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clickup_delivery_tasks (
      task_id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT,
      list_id TEXT,
      list_name TEXT,
      folder_name TEXT,
      status TEXT,
      status_type TEXT,
      client_option_id TEXT,
      client_name TEXT,
      due_date TEXT,
      created_date TEXT,
      closed_date TEXT,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clickup_delivery_tasks_status ON clickup_delivery_tasks(status_type, due_date);

    CREATE TABLE IF NOT EXISTS clickup_delivery_task_assignees (
      task_id TEXT NOT NULL REFERENCES clickup_delivery_tasks(task_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      username TEXT,
      PRIMARY KEY (task_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS clickup_delivery_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_status TEXT CHECK (last_status IN ('ok', 'error')),
      last_error TEXT,
      tasks_synced INTEGER
    );
  `);
}

module.exports = { up };
