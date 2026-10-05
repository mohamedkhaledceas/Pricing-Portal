/* A client's ClickUp work, fetched live for the Control Room's client
   detail (read-only, GET only).

   ClickUp has one workspace-wide "Client Name" dropdown, shared by the
   Commercial Lead pipeline, every Kitchen delivery list and Client Master
   (verified 2026-10-05: same field id on all of them, 184 options). A
   client's tasks are the workspace tasks whose dropdown is set to that
   client's option, so one filtered query finds them wherever they live.

   The portal stores no ClickUp option id, so a client is matched to its
   option by name (trimmed, case- and space-insensitive). Most portal
   clients came from this dropdown, but leads entered only as a deal
   "Company" have no option — those return `no_match`, not an error.

   Caching keeps a busy drawer within ClickUp's 100 requests/minute: the
   option list for 10 minutes, a client's tasks for 2. */
const CLIENT_NAME_FIELD_ID = '691263ea-3099-4f0c-b87f-950278899219';
// Any list carrying the field can describe it; this is the 2026 Projects pipeline.
const FIELD_SOURCE_LIST_ID = '901518274897';
const MAX_PAGES = 3; // 100 tasks per page
const OPTIONS_TTL_MS = 10 * 60 * 1000;
const TASKS_TTL_MS = 2 * 60 * 1000;

const normalize = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

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

function createClientTasksService({ clickupGet, now = () => Date.now() }) {
  let teamId = null;
  let options = { at: 0, byName: null };
  const tasksCache = new Map();

  async function getTeamId() {
    if (!teamId) {
      const { teams } = await clickupGet('/team');
      if (!teams || !teams.length) throw new Error('ClickUp returned no workspace for this API key.');
      teamId = teams[0].id;
    }
    return teamId;
  }

  async function getOptionsByName() {
    if (!options.byName || now() - options.at > OPTIONS_TTL_MS) {
      const { fields } = await clickupGet(`/list/${FIELD_SOURCE_LIST_ID}/field`);
      const field = (fields || []).find((f) => f.id === CLIENT_NAME_FIELD_ID);
      if (!field) throw new Error('ClickUp "Client Name" field not found on the pipeline list.');
      options = { at: now(), byName: new Map(field.type_config.options.map((o) => [normalize(o.name), o])) };
    }
    return options.byName;
  }

  /* names: the client's own name first, then any Odoo customer names —
     the first one with a ClickUp option wins. */
  async function getTasksForClient(names) {
    const byName = await getOptionsByName();
    const option = names.map((n) => byName.get(normalize(n))).find(Boolean);
    if (!option) return { status: 'no_match', optionName: null, tasks: [], truncated: false };

    const cached = tasksCache.get(option.id);
    if (cached && now() - cached.at < TASKS_TTL_MS) return cached.result;

    const team = await getTeamId();
    const filter = encodeURIComponent(JSON.stringify([{ field_id: CLIENT_NAME_FIELD_ID, operator: '=', value: option.id }]));
    const tasks = [];
    let truncated = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await clickupGet(`/team/${team}/task?custom_fields=${filter}&include_closed=true&subtasks=true&page=${page}`);
      tasks.push(...(res.tasks || []).map(toTask));
      if (res.last_page !== false) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
    const result = { status: 'ok', optionName: option.name, tasks, truncated };
    tasksCache.set(option.id, { at: now(), result });
    return result;
  }

  return { getTasksForClient };
}

module.exports = createClientTasksService;
