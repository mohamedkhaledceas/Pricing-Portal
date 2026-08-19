import { $, escapeHtml, toast } from './dom.js';
import { apiFetch } from './apiClient.js';
import { state } from './state.js';

const USER_MANAGER_ROLES = ['admin', 'manager', 'operations'];
const ASSIGNABLE_ROLES = ['employee', 'manager', 'operations', 'finance', 'admin', 'people_culture'];
const ROLE_LABELS = { employee: 'Employee', manager: 'Manager', operations: 'Operations', finance: 'Finance', admin: 'Admin', people_culture: 'People & Culture' };

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
window.usersChangeRole = changeRole;

async function toggleActive(id, active) {
  try {
    await apiFetch(`/api/users/${id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' });
    toast(active ? 'Reactivated' : 'Deactivated', 'info');
  } catch (err) {
    toast(err.message, 'danger');
  }
  await renderUsersAdmin();
}
window.usersToggleActive = toggleActive;

function renderUsersTable(users) {
  const myId = state.currentUser ? state.currentUser.id : null;
  const myRole = state.currentUser ? state.currentUser.role : null;

  const rows = users.map((u) => {
    const isSelf = u.id === myId;
    const canAct = !isSelf && clientCanAssignRole(myRole, u.role);
    const roleCell = canAct
      ? `<select class="form-control small" onchange="usersChangeRole(${u.id}, this.value)">${roleOptionsHtml(myRole, u.role)}</select>`
      : escapeHtml(ROLE_LABELS[u.role] || u.role);
    const statusBadge = u.isActive ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-neutral">Deactivated</span>';
    const statusBtn = canAct
      ? `<button type="button" class="btn small ${u.isActive ? 'danger' : ''}" onclick="usersToggleActive(${u.id}, ${!u.isActive})">${u.isActive ? 'Deactivate' : 'Reactivate'}</button>`
      : '';
    return `<tr>
      <td>${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${roleCell}</td>
      <td>${statusBadge}</td>
      <td>${statusBtn}</td>
    </tr>`;
  }).join('');

  $('#users-content').innerHTML = `
    <div class="card section">
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="empty-state">No accounts found</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

export async function renderUsersAdmin() {
  try {
    const res = await apiFetch('/api/users');
    renderUsersTable(res.users || []);
  } catch (err) {
    $('#users-content').innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message || 'Could not load accounts.')}</div></div>`;
  }
}
