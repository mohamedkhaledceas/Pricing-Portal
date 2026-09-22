import { $, esc } from './dom.js';
import { S } from './state.js';
import { num, fmt, pct } from './format.js';
import { currentProject, personById } from './calc.js';
import { apiRequest } from './apiClient.js';

/* Formats audit_log rows (already scoped to one project server-side, see
   GET /api/projects/:id/history) into plain-language sentences. Money
   fields are shown as the raw stored number + currency code rather than
   through money()/fromBase() — most of these fields (project.price,
   scenario.price, quote_line.amount, direct_cost.amount) are entered and
   stored directly in their own currency already (project quote currency,
   or the row's own `cur` for direct costs), not in the company base
   currency money() expects as input; running them through money() would
   silently double-convert. scenario.extra is the one field genuinely
   stored in base currency, so it's just labelled with S().currency. */
const rawMoney = (v, cur) => (v === null || v === undefined || v === '') ? '(empty)' : fmt(num(v), 0) + ' ' + (cur || S().currency);

const HISTORY_FIELD_CONFIG = {
  project: {
    name: { label: 'name', format: (v) => v || '(empty)' },
    client: { label: 'client', format: (v) => v || '(empty)' },
    status: { label: 'status', format: (v) => v || '(empty)' },
    start: { label: 'start month', format: (v) => v || '(empty)' },
    months: { label: 'duration', format: (v) => fmt(num(v), 2) + ' months' },
    target: { label: 'target margin', format: (v) => pct(num(v) / 100) },
    cont: { label: 'contingency', format: (v) => pct(num(v) / 100) },
    price: { label: 'price', format: (v, ctx) => (v === null || v === undefined || v === '') ? '(auto)' : rawMoney(v, ctx.cur) },
    cur: { label: 'quote currency', format: (v) => v || '' },
  },
  project_line: {
    personId: { label: 'assigned person', format: (v) => personName(v) },
    hours: { label: 'hours', format: (v) => fmt(num(v), 1) },
  },
  direct_cost: {
    name: { label: 'name', format: (v) => v || '(empty)' },
    amount: { label: 'amount', format: (v, ctx) => rawMoney(v, ctx.rowCur) },
    cur: { label: 'currency', format: (v) => v || '' },
  },
  scenario: {
    name: { label: 'name', format: (v) => v || '(empty)' },
    hoursFactor: { label: 'hours ×%', format: (v) => fmt(num(v), 0) + '%' },
    extra: { label: 'extra direct cost', format: (v) => rawMoney(v, S().currency) },
    price: { label: 'price override', format: (v, ctx) => (v === null || v === undefined || v === '') ? '(project price)' : rawMoney(v, ctx.cur) },
  },
  quote_line: {
    name: { label: 'name', format: (v) => v || '(empty)' },
    amount: { label: 'amount', format: (v, ctx) => rawMoney(v, ctx.cur) },
  },
};

const HISTORY_ENTITY_LABEL = {
  project: 'the project',
  project_line: 'a team line',
  direct_cost: 'a direct cost',
  scenario: 'a scenario',
  quote_line: 'a quote line',
};

function personName(personId) {
  if (!personId) return '(unassigned)';
  const p = personById(personId);
  return p ? (p.name || 'Unnamed') : 'a former team member';
}

function historyEntityDisplayName(entityType, obj) {
  if (!obj) return '';
  if (entityType === 'project_line') return personName(obj.personId);
  return obj.name || '';
}

function diffFields(before, after, config, ctx) {
  if (!before || !after) return [];
  const changes = [];
  Object.keys(config).forEach((key) => {
    const a = before[key] === undefined ? null : before[key];
    const b = after[key] === undefined ? null : after[key];
    if (a === b) return;
    const field = config[key];
    changes.push(`${field.label} from ${field.format(a, ctx)} to ${field.format(b, ctx)}`);
  });
  return changes;
}

function relativeTime(sqliteTimestamp) {
  if (!sqliteTimestamp) return '';
  const d = new Date(sqliteTimestamp.replace(' ', 'T') + 'Z');
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + (diffMin === 1 ? ' minute ago' : ' minutes ago');
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + (diffHr === 1 ? ' hour ago' : ' hours ago');
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return diffDay + (diffDay === 1 ? ' day ago' : ' days ago');
  return d.toLocaleDateString();
}

function formatHistoryEntry(entry) {
  const who = entry.username || 'Someone';
  const entityType = entry.entityType;
  const details = entry.details || {};
  const config = HISTORY_FIELD_CONFIG[entityType];
  const entityLabel = HISTORY_ENTITY_LABEL[entityType] || entityType;
  const verb = (entry.action || '').split('.')[1] || entry.action;
  const ctx = {
    cur: (currentProject() || {}).cur || S().currency,
    rowCur: (details.after && details.after.cur) || (details.before && details.before.cur),
  };

  let sentence;
  if (verb === 'create') {
    const name = historyEntityDisplayName(entityType, details.after);
    sentence = `${who} created ${entityLabel}${name ? ` "${name}"` : ''}`;
  } else if (verb === 'delete') {
    const name = historyEntityDisplayName(entityType, details.before);
    sentence = `${who} deleted ${entityLabel}${name ? ` "${name}"` : ''}`;
  } else if (verb === 'update' && config) {
    const changes = diffFields(details.before, details.after, config, ctx);
    sentence = changes.length ? `${who} changed ${changes.join(', ')}` : `${who} updated ${entityLabel}`;
  } else {
    sentence = `${who} updated ${entityLabel}`;
  }
  return { sentence, when: relativeTime(entry.createdAt) };
}

function renderHistoryList(entries) {
  const list = $('#historyList');
  if (!entries.length) {
    list.innerHTML = '<div class="muted" style="padding:10px 0">No changes recorded yet.</div>';
    return;
  }
  list.innerHTML = entries.map((entry) => {
    const { sentence, when } = formatHistoryEntry(entry);
    return `<div class="historyEntry">${esc(sentence)}<div class="historyWhen">${esc(when)}</div></div>`;
  }).join('');
}

async function openHistoryPanel() {
  const proj = currentProject();
  if (!proj) return;
  $('#historyBackdrop').hidden = false;
  $('#historyPanel').hidden = false;
  $('#historyList').innerHTML = '<div class="muted" style="padding:10px 0">Loading…</div>';
  try {
    const response = await apiRequest(`/api/projects/${proj.id}/history`);
    renderHistoryList(Array.isArray(response.history) ? response.history : []);
  } catch (err) {
    $('#historyList').innerHTML = `<div class="muted" style="padding:10px 0">Could not load history: ${esc(err.message || 'unknown error')}</div>`;
  }
}

function closeHistoryPanel() {
  $('#historyBackdrop').hidden = true;
  $('#historyPanel').hidden = true;
}

export function bindHistory() {
  $('#btnHistory').addEventListener('click', openHistoryPanel);
  $('#btnHistoryClose').addEventListener('click', closeHistoryPanel);
  $('#historyBackdrop').addEventListener('click', closeHistoryPanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#historyPanel').hidden) closeHistoryPanel();
  });
}
