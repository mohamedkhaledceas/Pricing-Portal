/* A client's ClickUp work, fetched live for the Control Room's client
   detail (read-only, GET only).

   Clients are ClickUp's workspace-wide "Client Name" dropdown options
   (migration 034), so each stores its option id. A client's tasks are the
   workspace tasks whose dropdown is set to that option — one filtered
   query finds them in every space, and a rename in ClickUp changes
   nothing here. Tasks are cached for 2 minutes per client to stay well
   inside ClickUp's 100 requests/minute. */
const MAX_PAGES = 3; // 100 tasks per page
const TASKS_TTL_MS = 2 * 60 * 1000;

function toTask(t) {
  const statusType = t.status && t.status.type;
  return {
    id: t.id,
    name: t.name,
    status: t.status ? t.status.status.trim() : null,
    statusColor: t.status ? t.status.color : null,
    closed: statusType === 'closed' || statusType === 'done',
    list: t.list ? t.list.name.trim() : null,
    folder: t.folder && !t.folder.hidden ? t.folder.name.trim() : null,
    assignees: (t.assignees || []).map((a) => a.username).filter(Boolean),
    dueDate: t.due_date ? new Date(Number(t.due_date)).toISOString() : null,
    updatedAt: t.date_updated ? new Date(Number(t.date_updated)).toISOString() : null,
    isSubtask: Boolean(t.parent),
    url: t.url,
  };
}

// clientNameFieldId: the dropdown's field id, from management/clients.
function createClientTasksService({ clickupGet, clientNameFieldId, now = () => Date.now() }) {
  let teamId = null;
  const tasksCache = new Map();

  async function getTeamId() {
    if (!teamId) {
      const { teams } = await clickupGet('/team');
      if (!teams || !teams.length) throw new Error('ClickUp returned no workspace for this API key.');
      teamId = teams[0].id;
    }
    return teamId;
  }

  async function getTasksForOption(optionId) {
    const cached = tasksCache.get(optionId);
    if (cached && now() - cached.at < TASKS_TTL_MS) return cached.result;

    const team = await getTeamId();
    const filter = encodeURIComponent(JSON.stringify([{ field_id: clientNameFieldId, operator: '=', value: optionId }]));
    const tasks = [];
    let truncated = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await clickupGet(`/team/${team}/task?custom_fields=${filter}&include_closed=true&subtasks=true&page=${page}`);
      tasks.push(...(res.tasks || []).map(toTask));
      if (res.last_page !== false) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
    const result = { status: 'ok', tasks, truncated };
    tasksCache.set(optionId, { at: now(), result });
    return result;
  }

  return { getTasksForOption };
}

module.exports = createClientTasksService;
