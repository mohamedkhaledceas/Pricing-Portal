import { $, esc } from './dom.js';
import { USER_MANAGER_ROLES } from './state.js';
import { apiRequest, getStoredAuth } from './apiClient.js';

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
function usersRoleOptionsHtml(myRole, currentRole) {
  return ASSIGNABLE_ROLES
    .filter((r) => myRole === 'admin' || r !== 'admin')
    .map((r) => `<option value="${r}" ${r === currentRole ? 'selected' : ''}>${esc(ROLE_LABELS[r])}</option>`)
    .join('');
}

export function renderUsersTable(users) {
  const auth = getStoredAuth();
  const myId = auth && auth.user ? auth.user.id : null;
  const myRole = auth && auth.user ? auth.user.role : null;

  $('#usersTableBody').innerHTML = users.map((u) => {
    const isSelf = u.id === myId;
    const canAct = !isSelf && clientCanAssignRole(myRole, u.role);
    const roleCell = canAct
      ? `<select data-id="${u.id}" data-act="role">${usersRoleOptionsHtml(myRole, u.role)}</select>`
      : esc(ROLE_LABELS[u.role] || u.role);
    const statusBadge = u.isActive ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-neutral">Deactivated</span>';
    const statusBtn = canAct
      ? `<button type="button" class="small ${u.isActive ? 'danger' : ''}" data-id="${u.id}" data-act="${u.isActive ? 'deactivate' : 'reactivate'}">${u.isActive ? 'Deactivate' : 'Reactivate'}</button>`
      : '';
    return `<tr>
      <td>${esc(u.firstName)} ${esc(u.lastName)}</td>
      <td>${esc(u.email)}</td>
      <td>${roleCell}</td>
      <td>${statusBadge}</td>
      <td>${statusBtn}</td>
    </tr>`;
  }).join('');
}

export async function loadUsersTable() {
  const errBox = $('#usersError');
  errBox.hidden = true;
  const cell = () => `<td><div class="skeleton" style="width:80%; height:13px;"></div></td>`;
  $('#usersTableBody').innerHTML = Array.from({ length: 5 }, () => `<tr>${cell().repeat(5)}</tr>`).join('');
  try {
    const result = await apiRequest('/api/users');
    renderUsersTable(result.users || []);
  } catch (err) {
    $('#usersTableBody').innerHTML = '';
    errBox.textContent = err.message || 'Could not load accounts.';
    errBox.hidden = false;
  }
}

export function bindUsersView() {
  $('#usersTableBody').addEventListener('change', async (e) => {
    if (e.target.dataset.act !== 'role') return;
    const id = e.target.dataset.id;
    const role = e.target.value;
    try {
      await apiRequest(`/api/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
      loadUsersTable();
    } catch (err) {
      alert('Could not change role: ' + err.message);
      loadUsersTable();
    }
  });
  $('#usersTableBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || !btn.dataset.act) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (act !== 'deactivate' && act !== 'reactivate') return;
    if (act === 'deactivate' && !confirm('Deactivate this account? They will be signed out and unable to log in until reactivated.')) return;
    try {
      await apiRequest(`/api/users/${id}/${act}`, { method: 'POST' });
      loadUsersTable();
    } catch (err) {
      alert('Could not update account: ' + err.message);
    }
  });
}
