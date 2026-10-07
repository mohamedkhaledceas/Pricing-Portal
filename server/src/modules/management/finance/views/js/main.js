import { $, $$, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch, bootstrapAuth } from './apiClient.js';
import { renderAll, loadClientOptions, clientIdFromLabel } from './render.js';

/* Server-side enforcement is requireRole(USER_MANAGER_ROLES) on every
   /api/finance/client-mapping route plus a role check in
   clientMappingService — this is defense in depth for the UI only. */
const MAPPING_ROLES = ['admin', 'ceo', 'operations'];

const API = '/api/finance/client-mapping';

async function loadData() {
  const res = await apiFetch(API);
  state.data = res.clientMapping;
  loadClientOptions();
}

function postJson(path, body) {
  return apiFetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function customerName(partnerId) {
  const c = state.data.customers.find((x) => x.odooPartnerId === partnerId);
  return c ? c.name : 'Odoo customer';
}

function clientName(clientId) {
  const c = state.data.clients.find((x) => x.id === clientId);
  return c ? c.name : 'client';
}

function showRowError(partnerId, message) {
  const el = document.querySelector(`[data-error="${partnerId}"]`);
  if (!el) { toast(message, 'danger'); return; }
  el.textContent = message;
  el.hidden = false;
}

/* Runs one write, then reloads the overview so counts, suggestions and
   statuses all reflect the server's view (a link can change another
   customer's suggestions, so patching one row locally would drift). */
async function act(row, request, successMessage) {
  if (state.busy) return;
  state.busy = true;
  if (row) row.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
  try {
    await request();
    state.confirmingUnlink = null;
    await loadData();
    renderAll();
    toast(successMessage, 'info');
  } catch (err) {
    if (row) row.querySelectorAll('button, input').forEach((el) => { el.disabled = false; });
    toast(err.message || 'That change could not be saved.', 'danger');
  } finally {
    state.busy = false;
  }
}

function onListClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const row = btn.closest('.cm-row');
  const partnerId = Number(btn.dataset.partner);
  const clientId = Number(btn.dataset.client);

  switch (btn.dataset.action) {
    case 'link':
      act(row, () => postJson('/links', { clientId, odooPartnerId: partnerId }),
        `Linked “${customerName(partnerId)}” to ${clientName(clientId)}.`);
      break;
    case 'reject':
      act(row, () => postJson('/rejections', { clientId, odooPartnerId: partnerId }),
        `Marked ${clientName(clientId)} as not “${customerName(partnerId)}”.`);
      break;
    case 'ask-unlink':
      state.confirmingUnlink = partnerId;
      renderAll();
      break;
    case 'cancel-unlink':
      state.confirmingUnlink = null;
      renderAll();
      break;
    case 'unlink':
      act(row, () => postJson('/rejections', { clientId, odooPartnerId: partnerId }),
        `Unlinked “${customerName(partnerId)}” from ${clientName(clientId)}.`);
      break;
    case 'expand':
      state.expanded.add(partnerId);
      renderAll();
      document.querySelector(`[data-picker="${partnerId}"]`)?.focus();
      break;
    case 'pick-link': {
      const input = document.querySelector(`[data-picker="${partnerId}"]`);
      const picked = clientIdFromLabel(input ? input.value : '');
      if (!picked) {
        showRowError(partnerId, 'Pick a ClickUp client from the list, or create a new one.');
        return;
      }
      act(row, () => postJson('/links', { clientId: picked, odooPartnerId: partnerId }),
        `Linked “${customerName(partnerId)}” to ${clientName(picked)}.`);
      break;
    }
    case 'create':
      act(row, () => postJson('/clients', { odooPartnerId: partnerId }),
        `Created client “${customerName(partnerId)}” and linked it.`);
      break;
    default:
  }
}

function onBulkClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'bulk-open') { state.bulkOpen = true; renderAll(); }
  if (btn.dataset.action === 'bulk-cancel') { state.bulkOpen = false; renderAll(); }
  if (btn.dataset.action === 'bulk-link') {
    const n = (state.data.exactPairs || []).length;
    state.bulkOpen = false;
    act($('#cmBulk'), () => postJson('/links/exact-names', {}), `Linked ${n} same-name pair${n === 1 ? '' : 's'}.`);
  }
}

/* Re-reads ClickUp's "Client Name" list (throttled server-side to once a
   minute); if it brought new or renamed clients, reload so they show. */
async function checkClickupClients() {
  state.clickupSync = { checking: true };
  renderAll();
  try {
    const { sync } = await apiFetch('/api/clients/clickup-sync', { method: 'POST' });
    state.clickupSync = sync;
    if (sync.changed) await loadData();
  } catch (err) {
    state.clickupSync = { status: 'error' };
  }
  renderAll();
}

function bindUi() {
  $('#btnLoginGateHome').addEventListener('click', () => { window.location.href = '/login'; });
  $('#btnLoginGateRetry').addEventListener('click', () => { window.location.reload(); });

  $$('#statusFilter [data-status]').forEach((b) => b.addEventListener('click', () => {
    state.status = b.dataset.status;
    state.confirmingUnlink = null;
    renderAll();
  }));
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderAll(); });
  $('#cmList').addEventListener('click', onListClick);
  $('#cmBulk').addEventListener('click', onBulkClick);
  $('#cmList').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('[data-picker]')) return;
    e.preventDefault();
    e.target.closest('.cm-row').querySelector('[data-action="pick-link"]').click();
  });
  $('#cmList').addEventListener('input', (e) => {
    if (!e.target.matches('[data-picker]')) return;
    const err = document.querySelector(`[data-error="${e.target.dataset.picker}"]`);
    if (err) err.hidden = true;
  });
}

(async function init() {
  bindUi();

  const ok = await bootstrapAuth();
  if (!ok || !state.currentUser || !MAPPING_ROLES.includes(state.currentUser.role)) {
    $('#loginGateChecking').hidden = true;
    $('#loginGateFail').hidden = false;
    return;
  }
  // One view, so the sidebar has no sections of its own here — the other
  // portal pages, Users, appearance and the account.
  window.AppShell.mount({
    appEl: $('#app'),
    page: 'client-mapping',
    pageLabel: 'Client mapping',
    role: state.currentUser.role,
    items: [],
    mountAccount: (el) => window.AccountMenu.mount(el, {
      variant: 'rail',
      apiFetch,
      currentUser: state.currentUser,
      getAccessToken: () => state.accessToken,
      onLogout: async () => {
        try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (err) {}
        window.location.href = '/login';
      },
    }),
  });
  $('#loginGate').style.display = 'none';
  $('#app').style.display = 'grid';
  renderAll();

  try {
    await loadData();
    if (state.data.summary.suggested === 0 && state.data.summary.unmatched > 0) state.status = 'unmatched';
    renderAll();
    checkClickupClients();
  } catch (err) {
    $('#app').style.display = 'none';
    $('#loginGate').style.display = 'flex';
    $('#loginGateChecking').hidden = true;
    if (err.status === 401 || err.status === 403) {
      $('#loginGateFail').hidden = false;
    } else {
      $('#loginGateError').querySelector('p').textContent = err.message || "Couldn't load client mapping.";
      $('#loginGateError').hidden = false;
    }
  }
})();
