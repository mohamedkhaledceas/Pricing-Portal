/* Handles the KPI webhook's taskStatusUpdated events — team-wide
   subscription (see docs/adr/0012), so this receives status changes for
   every list in the workspace and stores one kpi_clickup_status_events
   row per real assignee, for every list, not just currently-mapped ones
   (kpi_auto_metric_mappings can be pointed at a list's history later
   without needing a backfill — the events are already there). */
const logger = require('../../../common/logger');

function toIso(epochMsString) {
  if (!epochMsString) return null;
  return new Date(Number(epochMsString)).toISOString();
}

function createKpiClickupSyncService({ clickupGet, employeeRepository, kpiClickupStatusEventRepository }) {
  async function handleEvent(payload) {
    if (payload.event !== 'taskStatusUpdated') return;

    const statusChange = (payload.history_items || []).find((item) => item.field === 'status');
    if (!statusChange) return;

    const taskId = payload.task_id;
    const occurredAt = toIso(statusChange.date) || new Date().toISOString();
    // history_items[].id is ClickUp's own per-history-entry identifier —
    // the most granular unique key available for this exact transition,
    // used to dedupe ClickUp's documented at-least-once redelivery.
    const webhookEventId = statusChange.id || `${taskId}:${statusChange.date}`;

    let task;
    try {
      task = await clickupGet(`/task/${taskId}`);
    } catch (error) {
      // A task that's since been deleted, or a transient ClickUp API
      // error — logged, not thrown. One failed lookup must never take
      // down the whole webhook receiver for every other event.
      logger.warn('KPI ClickUp sync: could not fetch task for status event', { taskId, error: error.message });
      return;
    }

    const listId = task.list && task.list.id;
    const assignees = task.assignees || [];
    if (!listId || assignees.length === 0) {
      logger.info('KPI ClickUp sync: skipping event with no list or no assignees', { taskId });
      return;
    }

    for (const assignee of assignees) {
      const employee = employeeRepository.findByClickupUserId(assignee.id);
      if (!employee) {
        logger.info('KPI ClickUp sync: no matching employee for ClickUp assignee', { taskId, clickupUserId: assignee.id });
        continue;
      }
      const result = kpiClickupStatusEventRepository.insert({
        taskId,
        clickupListId: listId,
        employeeId: employee.id,
        fromStatus: statusChange.before ? statusChange.before.status : null,
        toStatus: statusChange.after ? statusChange.after.status : task.status.status,
        occurredAt,
        // Distinct per assignee — the same underlying ClickUp history item
        // still produces one event row per employee, since the metric is
        // per-employee, so the dedup key includes the employee.
        webhookEventId: `${webhookEventId}:${employee.id}`,
      });
      if (!result.inserted) {
        logger.info('KPI ClickUp sync: duplicate status event ignored', { taskId, employeeId: employee.id });
      }
    }
  }

  async function safeHandleEvent(payload) {
    try {
      await handleEvent(payload);
    } catch (error) {
      logger.error('KPI ClickUp sync failed to process webhook event', {
        event: payload.event,
        taskId: payload.task_id,
        message: error.message,
        stack: error.stack,
      });
    }
  }

  return { handleEvent, safeHandleEvent };
}

module.exports = createKpiClickupSyncService;
