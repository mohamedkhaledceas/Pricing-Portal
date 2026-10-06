/* Copies the ClickUp delivery space into the portal (migration 044) —
   read-only against ClickUp (GET only). Every run: all open tasks, plus
   tasks closed in the last CLOSED_WINDOW_DAYS, subtasks included; the copy
   is replaced whole in one transaction, so a task deleted or moved out of
   the space disappears too. An empty answer while the copy holds tasks is
   treated as a ClickUp problem and keeps the copy. One run at a time. */
const { DELIVERY_SPACE_ID, CLOSED_WINDOW_DAYS, MAX_PAGES } = require('../constants');

const CAIRO_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
const day = (ms) => (ms ? CAIRO_DATE.format(new Date(Number(ms))) : null);

function createDeliverySyncService({ clickupGet, deliveryRepository, transaction, logger, clientNameFieldId, now = () => Date.now() }) {
  let inFlight = null;

  async function readPages(query) {
    const { teams } = await clickupGet('/team');
    const team = teams[0].id;
    const tasks = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await clickupGet(`/team/${team}/task?page=${page}&subtasks=true&space_ids[]=${DELIVERY_SPACE_ID}&${query}`);
      tasks.push(...(res.tasks || []));
      if (res.last_page !== false) return tasks;
    }
    logger.warn('ClickUp delivery sync hit its page limit — the copy may be incomplete.', { query });
    return tasks;
  }

  function toRows(task, syncedAt) {
    const field = (task.custom_fields || []).find((f) => f.id === clientNameFieldId);
    const options = (field && field.type_config && field.type_config.options) || [];
    const option = field && field.value != null ? options.find((o) => o.id === field.value || o.orderindex === field.value) : null;
    return {
      task: {
        task_id: task.id,
        parent_id: task.parent || null,
        name: task.name,
        list_id: task.list ? task.list.id : null,
        list_name: task.list ? task.list.name : null,
        folder_name: task.folder && !task.folder.hidden ? task.folder.name : null,
        status: task.status ? task.status.status : null,
        status_type: task.status ? task.status.type : null,
        client_option_id: option ? option.id : null,
        client_name: option ? String(option.name).trim() : null,
        due_date: day(task.due_date),
        created_date: day(task.date_created),
        closed_date: day(task.date_done || task.date_closed),
        synced_at: syncedAt,
      },
      assignees: (task.assignees || []).map((a) => ({ task_id: task.id, user_id: String(a.id), username: a.username || a.email || String(a.id) })),
    };
  }

  async function run() {
    const at = new Date(now()).toISOString();
    try {
      const open = await readPages('include_closed=false');
      const recentClosed = (await readPages(`include_closed=true&date_updated_gt=${now() - CLOSED_WINDOW_DAYS * 864e5}`))
        .filter((t) => t.status && ['closed', 'done'].includes(t.status.type));
      const byId = new Map([...open, ...recentClosed].map((t) => [t.id, t]));
      const rows = [...byId.values()].map((t) => toRows(t, at));
      transaction(() => {
        if (rows.length === 0 && deliveryRepository.countTasks() > 0) {
          logger.warn('ClickUp delivery sync returned no tasks while the copy has some — keeping the copy.');
        } else {
          deliveryRepository.replaceAll(rows.map((r) => r.task), rows.flatMap((r) => r.assignees));
        }
        deliveryRepository.recordSync({ status: 'ok', at, tasks: rows.length });
      });
      return { status: 'ok', tasks: rows.length };
    } catch (error) {
      logger.error('ClickUp delivery sync failed — keeping the last copy.', { message: error.message });
      deliveryRepository.recordSync({ status: 'error', at, error: error.message });
      return { status: 'error' };
    }
  }

  function sync() {
    if (!inFlight) inFlight = run().finally(() => { inFlight = null; });
    return inFlight;
  }

  return { sync };
}

module.exports = createDeliverySyncService;
