import { $, $$, escapeHtml as esc, skeletonBlock } from './dom.js';
import { state } from './state.js';

const ENTITY_LABELS = { ceas: 'Ceas Comm', fze: 'Ceas Comm FZE', lwm: 'Learn with Marie' };
const REASON_LABELS = { name: 'same name', domain: 'same company domain' };

const EMPTY_NOTES = {
  suggested: 'Nothing needs review. Customers with no likely match are under Unmatched — link those by hand.',
  unmatched: 'Every Odoo customer is either linked or has a suggestion to review.',
  linked: 'No links confirmed yet. Start with Needs review.',
  all: 'No Odoo customers synced yet.',
};

/* Datalist labels must be unique to map back to a client id, so a
   duplicated client name gets its id appended. */
let clientIdByLabel = new Map();

export function clientIdFromLabel(label) {
  return clientIdByLabel.get(label.trim()) || null;
}

function renderClientOptions(clients) {
  const counts = new Map();
  clients.forEach((c) => counts.set(c.name, (counts.get(c.name) || 0) + 1));
  clientIdByLabel = new Map();
  $('#clientOptions').innerHTML = clients.map((c) => {
    const label = counts.get(c.name) > 1 ? `${c.name} (#${c.id})` : c.name;
    clientIdByLabel.set(label, c.id);
    return `<option value="${esc(label)}"></option>`;
  }).join('');
}

function matchesSearch(c, q) {
  if (!q) return true;
  const hay = [c.name, c.email, c.website, c.client && c.client.name, ...c.suggestions.map((s) => s.name)]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function customerCell(c) {
  const chips = c.entities.map((e) => `<span class="chip">${esc(ENTITY_LABELS[e] || e)}</span>`).join('');
  const invoices = c.invoiceCount
    ? `${c.invoiceCount} posted invoice${c.invoiceCount === 1 ? '' : 's'}${c.lastInvoiceDate ? ` · last ${esc(c.lastInvoiceDate)}` : ''}`
    : 'No posted invoices';
  const contact = [c.email, c.website].filter(Boolean).map(esc).join(' · ');
  return `
    <div>
      <div class="cm-name">${esc(c.name)}</div>
      <div class="cm-sub">${chips}${invoices}</div>
      ${contact ? `<div class="cm-sub">${contact}</div>` : ''}
    </div>`;
}

function picker(c) {
  return `
    <div class="cm-pick">
      <input list="clientOptions" data-picker="${c.odooPartnerId}" placeholder="Type a ClickUp client name…" aria-label="ClickUp client for ${esc(c.name)}">
      <button type="button" data-action="pick-link" data-partner="${c.odooPartnerId}">Link</button>
      <span class="or">or</span>
      <button type="button" class="ghost" data-action="create" data-partner="${c.odooPartnerId}">Create client</button>
    </div>
    <div class="cm-error" data-error="${c.odooPartnerId}" hidden></div>`;
}

function sideCell(c) {
  if (c.status === 'linked') {
    if (state.confirmingUnlink === c.odooPartnerId) {
      return `
        <div class="cm-confirm">
          <span>Unlink from <b>${esc(c.client.name)}</b>?</span>
          <button type="button" class="danger" data-action="unlink" data-partner="${c.odooPartnerId}" data-client="${c.client.id}">Unlink</button>
          <button type="button" class="ghost" data-action="cancel-unlink">Cancel</button>
        </div>`;
    }
    return `
      <div class="cm-linked">
        <span class="target">${esc(c.client.name)}</span>
        <button type="button" class="ghost" data-action="ask-unlink" data-partner="${c.odooPartnerId}">Unlink</button>
      </div>`;
  }

  if (c.status === 'suggested') {
    const suggestions = c.suggestions.map((s) => `
      <div class="cm-suggestion">
        <span class="target">${esc(s.name)}</span>
        <span class="why">${s.reasons.map((r) => REASON_LABELS[r] || r).join(' + ')}</span>
        <span class="actions">
          <button type="button" class="primary" data-action="link" data-partner="${c.odooPartnerId}" data-client="${s.clientId}">Link</button>
          <button type="button" class="ghost" data-action="reject" data-partner="${c.odooPartnerId}" data-client="${s.clientId}">Not a match</button>
        </span>
      </div>`).join('');
    const more = state.expanded.has(c.odooPartnerId)
      ? picker(c)
      : `<button type="button" class="cm-more" data-action="expand" data-partner="${c.odooPartnerId}">Link a different client…</button>`;
    return suggestions + more;
  }

  return picker(c);
}

function renderSkeleton() {
  $('#cmList').innerHTML = Array.from({ length: 6 }, () => `
    <div class="cm-row">
      <div>${skeletonBlock('60%', '14px')}<div style="margin-top:6px">${skeletonBlock('40%', '11px')}</div></div>
      <div>${skeletonBlock('80%', '28px')}</div>
    </div>`).join('');
}

export function renderAll() {
  const data = state.data;
  if (!data) { renderSkeleton(); return; }

  const { summary } = data;
  const counts = { suggested: summary.suggested, unmatched: summary.unmatched, linked: summary.linked, all: summary.odooCustomers };
  $$('[data-count]').forEach((el) => { el.textContent = counts[el.dataset.count]; });
  $$('#statusFilter [data-status]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === state.status)));
  $('#cmMeta').textContent = `${summary.clientsWithoutOdoo} of ${data.clients.length} clients not linked to Odoo yet`;

  renderBulk(data.exactPairs || []);
  renderSync();

  const q = state.search.trim().toLowerCase();
  const rows = data.customers.filter((c) => (state.status === 'all' || c.status === state.status) && matchesSearch(c, q));
  if (!rows.length) {
    $('#cmList').innerHTML = `<div class="empty-note">${q ? `No Odoo customers match “${esc(state.search.trim())}” here.` : EMPTY_NOTES[state.status]}</div>`;
    return;
  }
  $('#cmList').innerHTML = rows.map((c) => `
    <div class="cm-row" data-row="${c.odooPartnerId}">
      ${customerCell(c)}
      <div class="cm-side">${sideCell(c)}</div>
    </div>`).join('');
}

/* Same-name pairs: listed in full before anything is linked. */
function renderBulk(pairs) {
  const el = $('#cmBulk');
  if (!pairs.length) { el.innerHTML = ''; return; }
  const n = pairs.length;
  el.innerHTML = state.bulkOpen ? `
    <div class="cm-bulk">
      <p><b>Link ${n} Odoo customer${n > 1 ? 's' : ''} to the ClickUp client with the same name?</b>
        Names are compared ignoring case, punctuation and suffixes like LLC or Co. Each link is recorded in the audit log and can be unlinked later.</p>
      <ul class="cm-bulk-list">${pairs.map((p) => `<li>${esc(p.partnerName)} <span class="muted">→</span> ${esc(p.clientName)}</li>`).join('')}</ul>
      <div class="cm-bulk-actions">
        <button type="button" class="primary" data-action="bulk-link">Yes, link ${n}</button>
        <button type="button" class="ghost" data-action="bulk-cancel">Cancel</button>
      </div>
    </div>` : `
    <div class="cm-bulk">
      <p><b>${n} Odoo customer${n > 1 ? 's have' : ' has'} the same name as a ClickUp client</b> (ignoring case, punctuation and suffixes like LLC or Co.). Review them and link them in one step.</p>
      <div class="cm-bulk-actions"><button type="button" data-action="bulk-open">Review ${n} same-name pair${n > 1 ? 's' : ''}</button></div>
    </div>`;
}

/* Result of the ClickUp "Client Name" check run when this page loads. */
function renderSync() {
  const s = state.clickupSync;
  const el = $('#cmSync');
  if (!s) { el.textContent = ''; return; }
  el.textContent = s.status === 'error' ? 'ClickUp check failed — showing the last known clients'
    : s.checking ? 'Checking ClickUp for new clients…'
      : s.state && s.state.lastSuccessAt ? `ClickUp clients checked ${new Date(s.state.lastSuccessAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  el.classList.toggle('cm-sync-bad', s.status === 'error');
}

export function loadClientOptions() {
  renderClientOptions(state.data ? state.data.clients : []);
}
