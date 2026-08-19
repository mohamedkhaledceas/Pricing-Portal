import { $, $all } from './dom.js';
import { state } from './state.js';
import { apiFetch, bootstrapAuth } from './apiClient.js';
import { paintLogo, updateThemeToggleLabel, cycleTheme } from './theme.js';
import { renderOverview } from './overview.js';
import { renderNewRequestForm, renderRules, switchSubTab } from './timeOff.js';
import { renderTeam } from './team.js';
import { renderRoster } from './roster.js';
import { renderKpi } from './kpi.js';

const MANAGE_ROSTER_ROLES = ['admin'];

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
  // Admin can manage the roster with no employee profile at all (the
  // backend's canManageRoster grants it on auth role alone); P&C's access
  // is via the employee flag, which does require a profile.
  const isAdmin = state.currentUser && MANAGE_ROSTER_ROLES.includes(state.currentUser.role);
  $('#maintab-roster').style.display = isAdmin || (emp && emp.isPeopleCulture) ? '' : 'none';

  $('#loginGate').style.display = 'none';
  $('#app').style.display = 'block';

  renderNewRequestForm();
  renderRules();
  switchMainTab('overview', $('#maintab-overview'));
})();
