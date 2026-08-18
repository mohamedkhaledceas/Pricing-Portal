/* ClickUp custom-field resolution — turning raw task/custom-field API
   responses into the shape the rest of this module works with. Extracted
   unchanged from clickupSync.js. */
const { clickupGet } = require('../../../../common/integrations/clickupClient');

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

/* ClickUp date fields (both the task-level date_created/date_updated and
   date-type custom fields) are Unix-ms timestamp strings — meaningless as
   raw text in the UI. */
function toIso(unixMsString) {
  const ms = Number(unixMsString);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function formatDateDMY(unixMsString) {
  const ms = Number(unixMsString);
  if (!Number.isFinite(ms)) return unixMsString;
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/* ClickUp stores the SAME link record ({task_id, link_id} — whichever side
   the link was originally created from) verbatim on both linked tasks'
   linked_tasks arrays, rather than normalizing task_id to mean "self" —
   confirmed by inspecting real linked pairs via the API. So naively taking
   link_id gives the wrong ID (the task's own ID) whenever this task happens
   to be the one the entry's task_id already points at; whichever of the two
   ISN'T this task's own ID is the actual other side. */
function extractLinkedTaskIds(task) {
  return (task.linked_tasks || [])
    .map((l) => (l.task_id === task.id ? l.link_id : l.task_id))
    .filter((id) => id && id !== task.id);
}

/* drop_down fields return a raw index into type_config.options; labels
   (multi-select) fields return an array of option UUIDs; users fields
   return full user objects; date fields are Unix-ms strings. Everything
   else (text/number/url/etc.) is already a plain, meaningful value
   straight from the API. */
function resolveFieldValue(field, defs) {
  const def = defs[field.name];
  if (field.type === 'drop_down' && typeof field.value === 'number' && def?.options) {
    return def.options[field.value]?.name ?? field.value;
  }
  if (field.type === 'labels' && Array.isArray(field.value) && def?.options) {
    // Inconsistent with drop_down above: labels options key their text as
    // "label", not "name" — verified against a real field (confirmed via
    // GET /list/{id}/field), not assumed from the drop_down shape.
    return field.value.map((id) => def.options.find((o) => o.id === id)?.label ?? id);
  }
  if (field.type === 'users' && Array.isArray(field.value)) {
    return field.value.map((u) => u.username || u.email || u.id);
  }
  if (field.type === 'date') {
    return formatDateDMY(field.value);
  }
  return field.value;
}

function isPopulated(value) {
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
}

/* Takes a raw custom_fields array (same shape whether it came from
   GET /task/{id} or GET /list/{id}/task) plus the list it belongs to.
   Each field carries its ClickUp type alongside the resolved value, not
   just the bare value — the frontend needs the type to know a "url" field
   should render as a clickable link, not just text. */
async function extractPopulatedFields(customFields, listId) {
  const defs = await getFieldDefs(listId);
  const result = {};
  for (const field of customFields || []) {
    if (!isPopulated(field.value)) continue;
    result[field.name] = { value: resolveFieldValue(field, defs), type: field.type };
  }
  return result;
}

module.exports = {
  getFieldDefs,
  toIso,
  formatDateDMY,
  extractLinkedTaskIds,
  resolveFieldValue,
  isPopulated,
  extractPopulatedFields,
};
