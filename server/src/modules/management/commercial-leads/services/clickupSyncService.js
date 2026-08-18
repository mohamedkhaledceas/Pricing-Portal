/* Turns ClickUp webhook events (and, for reconciliation, full-list scans)
   into DB writes — the live cache, stage tracking/history, bucket-event
   ledger, and daily counts. Extracted unchanged from clickupSync.js, split
   so repositories only hold the raw SQL. */
const { clickupGet } = require('../../../../common/integrations/clickupClient');
const { emitClickupEvent } = require('../../../../common/realtime');
const logger = require('../../../../common/logger');
const { TRACKED_LISTS, INSIGHTS_LIST_ID } = require('../constants');
const { mapStatusToBucket } = require('./bucketService');
const {
  extractPopulatedFields,
  extractLinkedTaskIds,
  toIso,
} = require('./fieldResolutionService');
const dealRepository = require('../repositories/dealRepository');
const stageRepository = require('../repositories/stageRepository');
const bucketEventRepository = require('../repositories/bucketEventRepository');
const dailyCountsRepository = require('../repositories/dailyCountsRepository');
const statusColorRepository = require('../repositories/statusColorRepository');

function isPopulated(value) {
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
}

function removeFromLiveCache(taskId) {
  const listId = dealRepository.findListIdByDealId(taskId);
  dealRepository.remove(taskId); // cascades to stage_tracking
  return listId;
}

/* Append-only — one row per time a deal crosses INTO a funnel bucket (see
   bucketService). Keyed off the SAME "now" our sync observed the change,
   not any ClickUp-provided field. task.date_updated was considered and
   rejected: it fires on any edit to the task (a comment, an unrelated
   custom field change), not specifically on a status change, so it would
   be a worse proxy for "when did this transition happen" than our own
   observed time. Silently does nothing if newBucket is null (the new
   status doesn't map to any bucket, e.g. 'complete' — see
   docs/adr/0010-commercial-lead-quarterly-kpis.md) or unchanged from the
   previous bucket (a lateral move within the same bucket, e.g.
   qualified -> in queue, writes nothing). */
function recordBucketEvent(taskId, listId, previousStatus, newStatus, enteredAt) {
  const previousBucket = previousStatus ? mapStatusToBucket(previousStatus) : null;
  const newBucket = mapStatusToBucket(newStatus);
  if (!newBucket || newBucket === previousBucket) return;

  bucketEventRepository.insert({ dealId: taskId, listId, bucket: newBucket, enteredAt, isBackfilled: false });
}

/* Records the stage the deal is LEAVING (if we were already tracking it)
   into permanent history, then points tracking at the new stage. Uses our
   own previously-recorded status/timestamp as "from", not the webhook
   payload's own before/after — if a prior event was ever missed, this is
   the honest measure of what our system observed, which is the best any
   webhook-based approach can promise without perfect delivery. Self-guards
   against no-op calls (status matches what's already tracked), so callers
   can call this unconditionally rather than special-casing which event
   types might have changed the status. */
function recordStageTransition(taskId, listId, newStatus, previousTracking) {
  if (previousTracking && previousTracking.current_status === newStatus) return;

  const now = new Date().toISOString();
  if (previousTracking) {
    const enteredAtMs = new Date(previousTracking.entered_status_at).getTime();
    const daysInStage = (Date.now() - enteredAtMs) / 86400000;
    stageRepository.insertHistory({
      dealId: taskId,
      listId,
      status: previousTracking.current_status,
      enteredAt: previousTracking.entered_status_at,
      exitedAt: now,
      daysInStage,
    });
  }
  stageRepository.upsertTracking({ dealId: taskId, listId, status: newStatus, enteredAt: now });

  recordBucketEvent(taskId, listId, previousTracking ? previousTracking.current_status : null, newStatus, now);
}

/* Recomputed (not incrementally patched) from the live cache's current
   contents every time something relevant changes — a full aggregation over
   local DB rows, no ClickUp calls, so doing this on every event (or every
   reconciliation pass) is cheap. */
function recomputeDailyCounts(listId) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = dealRepository.findAllByListId(listId);

  const counts = {};
  const bump = (dimension, value) => {
    if (!isPopulated(value) || Array.isArray(value)) return;
    counts[dimension] = counts[dimension] || {};
    counts[dimension][value] = (counts[dimension][value] || 0) + 1;
  };

  let newLeadsToday = 0;
  for (const row of rows) {
    const fields = JSON.parse(row.fields_json || '{}');
    bump('status', row.status);
    /* Exact field names as defined in ClickUp, trailing spaces included —
       verified against the live field list, not guessed. */
    bump('source', fields['Source ']?.value);
    bump('business_line', fields['Company']?.value);
    bump('country', fields['Country ']?.value);
    /* clickup_created_at (ClickUp's real date_created), not our own
       created_at (when we first cached the row) — using our own sync
       bookkeeping here was the bug that made a one-time backfill look like
       196 new leads in a single day. */
    if (row.clickup_created_at && row.clickup_created_at.slice(0, 10) === today) newLeadsToday += 1;
  }
  counts.new_leads = { all: newLeadsToday };

  dailyCountsRepository.replaceForDate({ date: today, listId, counts });
}

/* Shared by both the webhook path and reconciliation — writes the cache
   row and (for 2026 Projects) reconciles stage tracking/history. Doesn't
   touch daily_counts; callers recompute that once after all their writes,
   not per-task, since a reconciliation pass touches hundreds of tasks. */
async function syncTaskRecord({ taskId, listId, name, status, customFields, subtasks, linkedTasks, clickupCreatedAt, clickupUpdatedAt }) {
  const fields = await extractPopulatedFields(customFields, listId);
  dealRepository.upsert({ dealId: taskId, listId, name, status, fields, subtasks, linkedTasks, clickupCreatedAt, clickupUpdatedAt });

  if (listId === INSIGHTS_LIST_ID) {
    const previousTracking = stageRepository.findTracking(taskId);
    recordStageTransition(taskId, listId, status, previousTracking);
  }
}

async function handleEvent(payload) {
  const { event, task_id: taskId } = payload;

  if (event === 'taskDeleted') {
    const listId = removeFromLiveCache(taskId);
    if (listId === INSIGHTS_LIST_ID) recomputeDailyCounts(INSIGHTS_LIST_ID);
    emitClickupEvent({ ...payload, current: null });
    return;
  }

  const task = await clickupGet(`/task/${taskId}?include_subtasks=true`);
  const listId = task.list?.id;

  if (!TRACKED_LISTS.has(listId)) {
    // Not one of ours, or just moved out of scope — make sure it isn't lingering.
    const previousListId = removeFromLiveCache(taskId);
    if (previousListId === INSIGHTS_LIST_ID) recomputeDailyCounts(INSIGHTS_LIST_ID);
    emitClickupEvent({ ...payload, current: null });
    return;
  }

  await syncTaskRecord({
    taskId: task.id,
    listId,
    name: task.name,
    status: task.status.status,
    customFields: task.custom_fields,
    subtasks: (task.subtasks || []).map((s) => ({ id: s.id, name: s.name, status: s.status?.status || '' })),
    linkedTasks: extractLinkedTaskIds(task),
    clickupCreatedAt: toIso(task.date_created),
    clickupUpdatedAt: toIso(task.date_updated),
  });

  if (listId === INSIGHTS_LIST_ID) recomputeDailyCounts(listId);

  const cached = dealRepository.findByDealId(taskId);
  emitClickupEvent({
    ...payload,
    current: cached ? { ...cached, fields: JSON.parse(cached.fields_json), subtasks: JSON.parse(cached.subtasks_json) } : null,
  });
}

async function safeHandleEvent(payload) {
  try {
    await handleEvent(payload);
  } catch (error) {
    logger.error('clickupSyncService failed to process webhook event', {
      event: payload.event,
      taskId: payload.task_id,
      message: error.message,
      stack: error.stack,
    });
  }
}

/* Paginates through every task in a list (ClickUp caps each page at 100).
   subtasks=true returns children as flat sibling entries (with a `parent`
   pointer) rather than nested — cheaper than fetching each task
   individually, and the only reason a full reconciliation pass costs
   roughly a dozen API calls total instead of hundreds. */
async function fetchAllListTasks(listId) {
  const tasks = [];
  let page = 0;
  for (;;) {
    const res = await clickupGet(`/list/${listId}/task?include_closed=true&subtasks=true&page=${page}`);
    const pageTasks = res.tasks || [];
    tasks.push(...pageTasks);
    if (pageTasks.length < 100) break;
    page += 1;
  }
  return tasks;
}

async function syncListStatuses(listId) {
  const list = await clickupGet(`/list/${listId}`);
  statusColorRepository.replaceForList({ listId, statuses: list.statuses || [] });
}

async function reconcileList(listId) {
  await syncListStatuses(listId);
  const allTasks = await fetchAllListTasks(listId);
  const parents = allTasks.filter((t) => !t.parent);
  const childrenByParent = {};
  for (const t of allTasks) {
    if (!t.parent) continue;
    childrenByParent[t.parent] = childrenByParent[t.parent] || [];
    childrenByParent[t.parent].push({ id: t.id, name: t.name, status: t.status?.status || '' });
  }

  const seenIds = new Set();
  for (const task of parents) {
    seenIds.add(task.id);
    await syncTaskRecord({
      taskId: task.id,
      listId,
      name: task.name,
      status: task.status.status,
      customFields: task.custom_fields,
      subtasks: childrenByParent[task.id] || [],
      linkedTasks: extractLinkedTaskIds(task),
      clickupCreatedAt: toIso(task.date_created),
      clickupUpdatedAt: toIso(task.date_updated),
    });
  }

  // Anything still cached for this list that ClickUp no longer has is stale — a missed taskDeleted.
  const cachedIds = dealRepository.listDealIdsByListId(listId);
  for (const dealId of cachedIds) {
    if (!seenIds.has(dealId)) {
      dealRepository.remove(dealId);
      logger.info('Reconciliation removed a cached deal no longer present in ClickUp', { dealId, listId });
    }
  }

  if (listId === INSIGHTS_LIST_ID) recomputeDailyCounts(listId);
}

/* One list's failure (a transient ClickUp error, a rate limit) shouldn't
   stop the other two from reconciling. */
async function runReconciliation() {
  for (const listId of TRACKED_LISTS) {
    try {
      await reconcileList(listId);
    } catch (error) {
      logger.error('Reconciliation failed for a list', { listId, message: error.message, stack: error.stack });
    }
  }
}

module.exports = {
  handleEvent: safeHandleEvent,
  runReconciliation,
  recomputeDailyCounts,
};
