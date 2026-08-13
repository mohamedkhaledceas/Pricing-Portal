const db = require('./db');
const { clickupGet } = require('./clickup');
const { emitClickupEvent } = require('./realtime');
const logger = require('./common/logger');

/* Only these 3 lists (all inside the "2026 - Ceas Comm" folder the webhook
   is scoped to) are synced at all. Of those, only 2026 Projects gets
   computed insights (stage tracking/history, daily counts) — Active
   Clients — AM and Client Offboarding list are live-display-only, per
   the discovery finding that neither is actually a funnel-shaped pipeline. */
const TRACKED_LISTS = new Set([
  '901518274897', // 2026 Projects
  '901522751511', // Active Clients — AM
  '901524651435', // Client Offboarding list
]);
const INSIGHTS_LIST_ID = '901518274897'; // 2026 Projects

/* Field-definition cache (option index/UUID -> label), per list, fetched
   once and kept for the process lifetime — these change rarely, and a
   stale cache after a genuine field-options edit self-heals on next
   deploy/restart. Not persisted; there's nothing here that needs to
   survive a restart. */
const fieldDefsCache = {};

async function getFieldDefs(listId) {
  if (fieldDefsCache[listId]) return fieldDefsCache[listId];
  const { fields } = await clickupGet(`/list/${listId}/field`);
  const map = {};
  for (const f of fields || []) {
    map[f.name] = { type: f.type, options: f.type_config?.options || [] };
  }
  fieldDefsCache[listId] = map;
  return map;
}

/* drop_down fields return a raw index into type_config.options; labels
   (multi-select) fields return an array of option UUIDs; users fields
   return full user objects. Everything else (text/date/number/url/etc.)
   is already a plain, meaningful value straight from the API. */
function resolveFieldValue(field, defs) {
  const def = defs[field.name];
  if (field.type === 'drop_down' && typeof field.value === 'number' && def?.options) {
    return def.options[field.value]?.name ?? field.value;
  }
  if (field.type === 'labels' && Array.isArray(field.value) && def?.options) {
    return field.value.map((id) => def.options.find((o) => o.id === id)?.name ?? id);
  }
  if (field.type === 'users' && Array.isArray(field.value)) {
    return field.value.map((u) => u.username || u.email || u.id);
  }
  return field.value;
}

function isPopulated(value) {
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
}

async function extractPopulatedFields(task) {
  const defs = await getFieldDefs(task.list.id);
  const result = {};
  for (const field of task.custom_fields || []) {
    if (!isPopulated(field.value)) continue;
    result[field.name] = resolveFieldValue(field, defs);
  }
  return result;
}

function upsertLiveCache(task, fields) {
  const now = new Date().toISOString();
  const subtasks = (task.subtasks || []).map((s) => ({ id: s.id, name: s.name, status: s.status?.status || '' }));
  db.prepare(`
    INSERT INTO commercial_lead_live_cache (deal_id, list_id, name, status, fields_json, subtasks_json, created_at, updated_at)
    VALUES (@deal_id, @list_id, @name, @status, @fields_json, @subtasks_json, @now, @now)
    ON CONFLICT(deal_id) DO UPDATE SET
      list_id = excluded.list_id,
      name = excluded.name,
      status = excluded.status,
      fields_json = excluded.fields_json,
      subtasks_json = excluded.subtasks_json,
      updated_at = excluded.updated_at
  `).run({
    deal_id: task.id,
    list_id: task.list.id,
    name: task.name,
    status: task.status.status,
    fields_json: JSON.stringify(fields),
    subtasks_json: JSON.stringify(subtasks),
    now,
  });
}

function removeFromLiveCache(taskId) {
  const row = db.prepare('SELECT list_id FROM commercial_lead_live_cache WHERE deal_id = ?').get(taskId);
  db.prepare('DELETE FROM commercial_lead_live_cache WHERE deal_id = ?').run(taskId); // cascades to stage_tracking
  return row ? row.list_id : null;
}

/* Records the stage the deal is LEAVING (if we were already tracking it)
   into permanent history, then points tracking at the new stage. Uses our
   own previously-recorded status/timestamp as "from", not the webhook
   payload's own before/after — if a prior event was ever missed, this is
   the honest measure of what our system observed, which is the best any
   webhook-based approach can promise without perfect delivery. */
function recordStageTransition(taskId, listId, newStatus, previousTracking) {
  if (previousTracking && previousTracking.current_status === newStatus) {
    // Re-fetched current state matches what we already had — e.g. a
    // taskStatusUpdated event followed by a re-fetch that lands after the
    // status changed again, or (as hit in testing) a webhook payload whose
    // claimed transition didn't match ClickUp's actual current state.
    // Nothing really transitioned; recording one would create a bogus
    // near-zero-duration stage_history row.
    return;
  }
  const now = new Date().toISOString();
  if (previousTracking) {
    const enteredAtMs = new Date(previousTracking.entered_status_at).getTime();
    const daysInStage = (Date.now() - enteredAtMs) / 86400000;
    db.prepare(`
      INSERT INTO commercial_lead_stage_history (deal_id, list_id, status, entered_at, exited_at, days_in_stage)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(taskId, listId, previousTracking.current_status, previousTracking.entered_status_at, now, daysInStage);
  }
  db.prepare(`
    INSERT INTO commercial_lead_stage_tracking (deal_id, list_id, current_status, entered_status_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(deal_id) DO UPDATE SET
      list_id = excluded.list_id,
      current_status = excluded.current_status,
      entered_status_at = excluded.entered_status_at
  `).run(taskId, listId, newStatus, now);
}

/* Recomputed (not incrementally patched) from the live cache's current
   contents every time something relevant changes — a full GROUP BY over
   local DB rows, no ClickUp calls, so doing this on every event is cheap.
   Upserted into today's row, so re-running later the same day corrects
   today's numbers rather than duplicating them. */
function recomputeDailyCounts(listId) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare('SELECT status, fields_json, created_at FROM commercial_lead_live_cache WHERE list_id = ?').all(listId);

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
    bump('source', fields['Source ']);
    bump('business_line', fields['Company']);
    bump('country', fields['Country ']);
    if (row.created_at && row.created_at.slice(0, 10) === today) newLeadsToday += 1;
  }
  counts.new_leads = { all: newLeadsToday };

  /* Full replace of today's rows for this list, not a selective upsert —
     a dimension/value combo that had a count yesterday but has zero deals
     today (e.g. every deal has since left "qualified") must disappear, not
     linger at its last-known count. Upserting only the combos present in
     this run can't express "this went to zero." */
  const del = db.prepare('DELETE FROM commercial_lead_daily_counts WHERE date = ? AND list_id = ?');
  const insert = db.prepare(`
    INSERT INTO commercial_lead_daily_counts (date, list_id, dimension, value, count)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    del.run(today, listId);
    for (const [dimension, values] of Object.entries(counts)) {
      for (const [value, count] of Object.entries(values)) {
        insert.run(today, listId, dimension, String(value), count);
      }
    }
  });
  tx();
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

  const fields = await extractPopulatedFields(task);
  upsertLiveCache(task, fields);

  if (listId === INSIGHTS_LIST_ID) {
    const previousTracking = db.prepare('SELECT * FROM commercial_lead_stage_tracking WHERE deal_id = ?').get(taskId);
    if (event === 'taskStatusUpdated') {
      recordStageTransition(taskId, listId, task.status.status, previousTracking);
    } else if (!previousTracking) {
      recordStageTransition(taskId, listId, task.status.status, null);
    }
    recomputeDailyCounts(listId);
  }

  const cached = db.prepare('SELECT * FROM commercial_lead_live_cache WHERE deal_id = ?').get(taskId);
  emitClickupEvent({
    ...payload,
    current: cached ? { ...cached, fields: JSON.parse(cached.fields_json), subtasks: JSON.parse(cached.subtasks_json) } : null,
  });
}

async function safeHandleEvent(payload) {
  try {
    await handleEvent(payload);
  } catch (error) {
    logger.error('clickupSync failed to process webhook event', {
      event: payload.event,
      taskId: payload.task_id,
      message: error.message,
      stack: error.stack,
    });
  }
}

module.exports = { handleEvent: safeHandleEvent, TRACKED_LISTS, INSIGHTS_LIST_ID, recomputeDailyCounts };
