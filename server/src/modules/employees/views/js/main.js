import { $, $all } from './dom.js';
import { state } from './state.js';
import { apiFetch, bootstrapAuth } from './apiClient.js';
import { paintLogo, updateThemeToggleLabel, cycleTheme } from './theme.js';
import { renderOverview } from './overview.js';
import { renderNewRequestForm, renderRules, switchSubTab } from './timeOff.js';
import { renderTeam } from './team.js';
import { renderRoster } from './roster.js';
import { renderKpi } from './kpi.js';
import { renderUsersAdmin } from './usersAdmin.js';

const MANAGE_ROSTER_ROLES = ['admin', 'people_culture'];
// Same gate as margin-planner_1.html's own Commercial Lead button
// (USER_MANAGER_ROLES) — role only.
const MARGIN_PLANNER_ROLES = ['manager', 'operations', 'admin'];
// Matches commercial-lead's own USER_MANAGER_ROLES gate for the Users menu item.
const USER_MANAGER_ROLES = ['admin', 'manager', 'operations'];

export function switchMainTab(tabId, btn) {
  state.mainTab = tabId;
  $all('.nav-tab').forEach((t) => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  $all('#content > .tab-panel').forEach((p) => p.classList.remove('active'));
  const panel = $('#tab-' + tabId);
  if (panel) panel.classList.add('active');

  $('#timeoff-subnav').style.display = tabId === 'timeoff' ? 'flex' : 'none';

  if (tabId === 'overview') renderOverview();
  if (tabId === 'timeoff') switchSubTab(state.subTab, $('#subtab-' + state.subTab));
  if (tabId === 'team') renderTeam();
  if (tabId === 'roster') renderRoster();
  if (tabId === 'kpi') renderKpi();
  if (tabId === 'users') renderUsersAdmin();
}
window.switchMainTab = switchMainTab;

function bindUi() {
  $('#brandLogo').addEventListener('click', () => { window.location.href = '/'; });
  $('#btnAccountMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#accountMenu');
    menu.hidden = !menu.hidden;
    $('#btnAccountMenu').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', () => { $('#accountMenu').hidden = true; });
  $('#btnThemeToggle').addEventListener('click', (e) => { e.stopPropagation(); cycleTheme(); });
  $('#btnMarginPlanner').addEventListener('click', () => { window.location.href = '/planner'; });
  $('#btnUsersView').addEventListener('click', () => { switchMainTab('users'); });
  $('#btnLogout').addEventListener('click', async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (err) {}
    window.location.href = '/';
  });

  $all('.nav-tab').forEach((btn) => btn.addEventListener('click', () => switchMainTab(btn.dataset.tab, btn)));
  $all('.sub-nav-tab').forEach((btn) => btn.addEventListener('click', () => switchSubTab(btn.dataset.subtab, btn)));
}

(async function init() {
  updateThemeToggleLabel();
  paintLogo();
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintLogo);
  }
  bindUi();

  const ok = await bootstrapAuth();
  if (!ok) {
    $('#loginGateChecking').hidden = true;
    $('#loginGateFail').hidden = false;
    return;
  }

  const meRes = await apiFetch('/api/employees/me');
  state.myEmployee = meRes.employee;

  $('#accountMenuEmail').textContent = state.currentUser ? state.currentUser.email || '' : '';
  const emp = state.myEmployee;
  // "My Team" tab stays visible whenever the viewer has an employee profile
  // at all — renderTeam() itself shows an empty state if they manage no one.
  $('#maintab-team').style.display = emp ? '' : 'none';
  // Admin and P&C can both manage the roster with no employee profile at
  // all — the backend's canManageRoster grants it on auth role alone.
  const canManageRoster = state.currentUser && MANAGE_ROSTER_ROLES.includes(state.currentUser.role);
  $('#maintab-roster').style.display = canManageRoster ? '' : 'none';
  $('#btnMarginPlanner').hidden = !(state.currentUser && MARGIN_PLANNER_ROLES.includes(state.currentUser.role));
  const canManageUsers = state.currentUser && USER_MANAGER_ROLES.includes(state.currentUser.role);
  $('#btnUsersView').hidden = !canManageUsers;

  $('#loginGate').style.display = 'none';
  $('#app').style.display = 'block';

  renderNewRequestForm();
  renderRules();

  // Lets /commercial-lead's own Users menu item deep-link here (this page is
  // now the landing page at "/") rather than duplicating the Users view.
  const params = new URLSearchParams(window.location.search);
  if (params.get('open') === 'users' && canManageUsers) {
    switchMainTab('users');
    params.delete('open');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
  } else {
    switchMainTab('overview', $('#maintab-overview'));
  }
})();
