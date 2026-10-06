/* clickup_delivery_tasks + assignees + sync state (migration 044). Only
   SQL here. The sync replaces the task copy whole on every run. */
const db = require('../../../../db');

const TASK_COLUMNS = [
  'task_id', 'parent_id', 'name', 'list_id', 'list_name', 'folder_name', 'status', 'status_type', 'client_option_id',
  'client_name', 'due_date', 'created_date', 'closed_date', 'synced_at',
];
const insertTask = db.prepare(`INSERT INTO clickup_delivery_tasks (${TASK_COLUMNS.join(', ')})
  VALUES (${TASK_COLUMNS.map((c) => `@${c}`).join(', ')})`);
const insertAssignee = db.prepare('INSERT OR IGNORE INTO clickup_delivery_task_assignees (task_id, user_id, username) VALUES (?, ?, ?)');

const OPEN = "status_type NOT IN ('closed', 'done')";

function replaceAll(tasks, assignees) {
  db.prepare('DELETE FROM clickup_delivery_task_assignees').run();
  db.prepare('DELETE FROM clickup_delivery_tasks').run();
  for (const t of tasks) insertTask.run(t);
  for (const a of assignees) insertAssignee.run(a.task_id, a.user_id, a.username);
}

// Incremental: replace just these tasks (and their assignees).
function upsertTasks(tasks, assignees) {
  const delA = db.prepare('DELETE FROM clickup_delivery_task_assignees WHERE task_id = ?');
  const delT = db.prepare('DELETE FROM clickup_delivery_tasks WHERE task_id = ?');
  for (const t of tasks) { delA.run(t.task_id); delT.run(t.task_id); }
  for (const t of tasks) insertTask.run(t);
  for (const a of assignees) insertAssignee.run(a.task_id, a.user_id, a.username);
}

function countTasks() {
  return db.prepare('SELECT COUNT(*) AS n FROM clickup_delivery_tasks').get().n;
}

function countOpen(today, weekEnd) {
  return db.prepare(`
    SELECT COUNT(*) AS open,
           SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue,
           SUM(CASE WHEN due_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS dueThisWeek,
           SUM(CASE WHEN due_date IS NULL THEN 1 ELSE 0 END) AS noDueDate
    FROM clickup_delivery_tasks WHERE ${OPEN}
  `).get(today, today, weekEnd);
}

function openByStage(today) {
  return db.prepare(`
    SELECT LOWER(TRIM(status)) AS stage, COUNT(*) AS open, SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue
    FROM clickup_delivery_tasks WHERE ${OPEN} GROUP BY stage
  `).all(today);
}

function openByClient(today) {
  return db.prepare(`
    SELECT client_option_id AS optionId, COALESCE(client_name, '') AS client, COUNT(*) AS open,
           SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue,
           SUM(CASE WHEN LOWER(TRIM(status)) = 'client submission' THEN 1 ELSE 0 END) AS withClient,
           MIN(CASE WHEN due_date < ? THEN due_date END) AS oldestOverdue
    FROM clickup_delivery_tasks WHERE ${OPEN} GROUP BY client_option_id ORDER BY overdue DESC, open DESC
  `).all(today, today);
}

function openByPerson(today, weekEnd) {
  return db.prepare(`
    SELECT a.user_id AS userId, a.username AS name, COUNT(*) AS open,
           SUM(CASE WHEN t.due_date < ? THEN 1 ELSE 0 END) AS overdue,
           SUM(CASE WHEN t.due_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS dueThisWeek
    FROM clickup_delivery_task_assignees a JOIN clickup_delivery_tasks t ON t.task_id = a.task_id
    WHERE t.${OPEN}
    GROUP BY a.user_id ORDER BY overdue DESC, open DESC
  `).all(today, today, weekEnd);
}

function countUnassignedOpen(today) {
  return db.prepare(`
    SELECT COUNT(*) AS open, SUM(CASE WHEN t.due_date < ? THEN 1 ELSE 0 END) AS overdue
    FROM clickup_delivery_tasks t
    WHERE t.${OPEN} AND NOT EXISTS (SELECT 1 FROM clickup_delivery_task_assignees a WHERE a.task_id = t.task_id)
  `).get(today);
}

function listOverdue(today, limit) {
  return db.prepare(`
    SELECT t.task_id AS taskId, t.name, t.status, t.list_name AS listName, t.client_name AS client, t.due_date AS dueDate,
           (SELECT GROUP_CONCAT(a.username, ', ') FROM clickup_delivery_task_assignees a WHERE a.task_id = t.task_id) AS assignees
    FROM clickup_delivery_tasks t WHERE t.${OPEN} AND t.due_date < ?
    ORDER BY t.due_date, t.task_id LIMIT ?
  `).all(today, limit);
}

function getSyncState() {
  const r = db.prepare('SELECT * FROM clickup_delivery_sync_state WHERE id = 1').get();
  return r ? { lastSuccessAt: r.last_success_at, lastStatus: r.last_status, tasksSynced: r.tasks_synced } : { lastSuccessAt: null, lastStatus: null, tasksSynced: null };
}

function recordSync({ status, at, error = null, tasks = null }) {
  db.prepare(`
    INSERT INTO clickup_delivery_sync_state (id, last_attempt_at, last_success_at, last_status, last_error, tasks_synced)
    VALUES (1, @at, CASE WHEN @status = 'ok' THEN @at END, @status, @error, @tasks)
    ON CONFLICT(id) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = COALESCE(excluded.last_success_at, clickup_delivery_sync_state.last_success_at),
      last_status = excluded.last_status, last_error = excluded.last_error,
      tasks_synced = COALESCE(excluded.tasks_synced, clickup_delivery_sync_state.tasks_synced)
  `).run({ status, at, error, tasks });
}

module.exports = {
  replaceAll, upsertTasks, countTasks, countOpen, openByStage, openByClient, openByPerson, countUnassignedOpen, listOverdue,
  getSyncState, recordSync,
};
