import { $, escapeHtml, toast } from './dom.js';
import { apiFetch } from './apiClient.js';
import { state } from './state.js';

const USER_MANAGER_ROLES = ['admin', 'ceo', 'operations'];
const ASSIGNABLE_ROLES = ['employee', 'ceo', 'operations', 'finance', 'admin', 'people_culture', 'commercial', 'account_management'];
const ROLE_LABELS = { employee: 'Employee', ceo: 'CEO', operations: 'Operations', finance: 'Finance', admin: 'Admin', people_culture: 'People & Culture', commercial: 'Commercial', account_management: 'Account Management' };

/* Mirrors the server's canAssignRole in common/permissions.js — this is only
   for hiding/disabling controls that would fail anyway; the server is what
   actually enforces it. */
function clientCanAssignRole(myRole, targetRole) {
  if (!USER_MANAGER_ROLES.includes(myRole)) return false;
  if (myRole === 'admin') return true;
  return targetRole !== 'admin';
}

function roleOptionsHtml(myRole, currentRole) {
  return ASSIGNABLE_ROLES
    .filter((r) => myRole === 'admin' || r !== 'admin')
    .map((r) => `<option value="${r}" ${r === currentRole ? 'selected' : ''}>${escapeHtml(ROLE_LABELS[r] || r)}</option>`)
    .join('');
}

async function changeRole(id, role) {
  try {
    await apiFetch(`/api/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
    toast('Role updated', 'info');
  } catch (err) {
    toast(err.message, 'danger');
  }
  await renderUsersAdmin();
}

async function toggleActive(id, active) {
  try {
    await apiFetch(`/api/users/${id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' });
    toast(active ? 'Reactivated' : 'Deactivated', 'info');
  } catch (err) {
    toast(err.message, 'danger');
  }
  await renderUsersAdmin();
}

function copyUuid(uuid) {
  navigator.clipboard.writeText(uuid)
    .then(() => toast('UUID copied', 'info'))
    .catch(() => toast('Could not copy — select and copy manually', 'danger'));
}

// Delegated on #users-content — guarded against double-binding since
// renderUsersAdmin() re-runs on this same persisting element after every
// role change/activation toggle, not just on tab switch (see changeRole/
// toggleActive above). Replaces onclick=".../onchange="..." attributes,
// which the CSP's script-src-attr 'none' silently blocks (confirmed live,
// 2026-09-28, on the sibling Overview-page/Team-Reviews bugs — same root
// cause).
function bindUsersTableUi(container) {
  if (container._usersTableBound) return;
  container._usersTableBound = true;
  container.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-role-select]');
    if (!sel) return;
    changeRole(Number(sel.dataset.userId), sel.value);
  });
  container.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-toggle-active]');
    if (toggleBtn) { toggleActive(Number(toggleBtn.dataset.userId), toggleBtn.dataset.newActive === 'true'); return; }
    const copyBtn = e.target.closest('[data-copy-uuid]');
    if (copyBtn) copyUuid(copyBtn.dataset.copyUuid);
  });
}

// UUID column is admin-only — the server already withholds `uuid` from the
// response entirely for non-admin roles (accountAdminService.listUsers), so
// this is belt-and-suspenders on top of that, not the actual gate. Support
// workflow: an employee reports a bug, admin opens this table, copies the
// UUID, greps the log files with it (see common/audit.js) to see that
// account's logins, actions, and errors in one place. Never shown to the
// account holder themselves.
function renderUsersTable(users) {
  const myId = state.currentUser ? state.currentUser.id : null;
  const myRole = state.currentUser ? state.currentUser.role : null;
  const showUuid = myRole === 'admin';

  const rows = users.map((u) => {
    const isSelf = u.id === myId;
    const canAct = !isSelf && clientCanAssignRole(myRole, u.role);
    const roleCell = canAct
      ? `<select class="form-control small" data-role-select data-user-id="${u.id}">${roleOptionsHtml(myRole, u.role)}</select>`
      : escapeHtml(ROLE_LABELS[u.role] || u.role);
    const statusBadge = u.isActive ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-neutral">Deactivated</span>';
    const statusBtn = canAct
      ? `<button type="button" class="btn small ${u.isActive ? 'danger' : ''}" data-toggle-active data-user-id="${u.id}" data-new-active="${!u.isActive}">${u.isActive ? 'Deactivate' : 'Reactivate'}</button>`
      : '';
    const uuidCell = showUuid
      ? `<td class="uuid-col"><span class="small muted" style="font-family:monospace;">${escapeHtml(u.uuid || '—')}</span>${u.uuid ? ` <button type="button" class="btn small" data-copy-uuid="${escapeHtml(u.uuid)}" title="Copy UUID">Copy</button>` : ''}</td>`
      : '';
    return `<tr>
      <td>${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${roleCell}</td>
      <td>${statusBadge}</td>
      <td>${statusBtn}</td>
      ${uuidCell}
    </tr>`;
  }).join('');

  const container = $('#users-content');
  container.innerHTML = `
    <div class="card section">
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th>${showUuid ? '<th class="uuid-col">UUID (support tracing)</th>' : ''}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${showUuid ? 6 : 5}" class="empty-state">No accounts found</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
  bindUsersTableUi(container);
}

export async function renderUsersAdmin() {
  try {
    const res = await apiFetch('/api/users');
    renderUsersTable(res.users || []);
  } catch (err) {
    $('#users-content').innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message || 'Could not load accounts.')}</div></div>`;
  }
}

// A plain fetch, not apiFetch — the download needs the Authorization
// header, which a bare <a href> can't carry, and apiFetch always calls
// res.json() (this response is a CSV blob). Same pattern as the Employees
// module's own KPI history CSV export (views/js/kpiHistory.js) and
// commercial-leads' deals export (views/js/deals.js).
async function downloadUsersCsv() {
  const res = await fetch('/api/users/export', {
    headers: { Authorization: 'Bearer ' + state.accessToken },
  });
  if (!res.ok) {
    let message = 'Export failed. Please try again.';
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch (err) {}
    toast(message, 'danger');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Called once from main.js's bindUi() — the button lives in the tab's
// static page-header, outside the #users-content markup that
// renderUsersAdmin() replaces on every tab switch.
export function bindUsersAdminUi() {
  $('#btnExportUsers').addEventListener('click', downloadUsersCsv);
}
