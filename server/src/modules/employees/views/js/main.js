import { $, $all } from './dom.js';
import { state } from './state.js';
import { apiFetch, bootstrapAuth } from './apiClient.js';
import { renderOverview, bindOverviewUi } from './overview.js';
import { renderNewRequestForm, renderRules, switchSubTab } from './timeOff.js';
import { renderTeam } from './team.js';
import { renderTeamsDirectory } from './teamsDirectory.js';
import { renderRequestsCenter } from './requestsCenter.js';
import { renderRoster } from './roster.js';
import { renderKpi } from './kpi.js';
import { renderUsersAdmin, bindUsersAdminUi } from './usersAdmin.js';
import { renderLeaveReport } from './leaveBreakdown.js';
import { connectRealtime } from './realtime.js';

// 'ceo' (renamed from 'manager' in migration 024) is this org's single
// top-level exec role — full company-wide roster access, same as
// people_culture (see rosterService.canManageRoster). Must match that
// function's role set exactly — it previously omitted 'operations', which
// the backend already granted full roster access to; that mismatch meant
// an operations-role user could call the roster APIs directly but never
// see the tab that reaches them.
const MANAGE_ROSTER_ROLES = ['admin', 'people_culture', 'ceo', 'operations'];
// Leave Report is scoped to the two roles that actually review/approve
// requests — not admin (canManageRoster's superset doesn't apply here).
const LEAVE_REPORT_ROLES = ['ceo', 'people_culture', 'admin'];
// Matches commercial-lead's own USER_MANAGER_ROLES gate for the Users menu item.
const USER_MANAGER_ROLES = ['admin', 'ceo', 'operations'];

// The sidebar's sections (shared shell, public/shared/appShell.js). Links
// to the other portal pages, and Users (shown in the sidebar's Admin group,
// opening the #tab-users panel here), come from the shell itself.
const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'timeoff', label: 'Time off', icon: 'calendar' },
  { id: 'requests', label: 'Requests', icon: 'inbox' },
  { id: 'kpi', label: 'KPIs', icon: 'targets' },
  { id: 'team', label: 'My team', icon: 'people' },
  { id: 'teams', label: 'Teams', icon: 'clients' },
  { id: 'roster', label: 'Roster', icon: 'roster' },
  { id: 'leave-report', label: 'Leave report', icon: 'report' },
];

// opts.kpiView lets a caller deep-link into a specific KPI sub-view (see
// renderKpi's own comment) — e.g. Overview's "Go to Team Reviews" button
// passes { kpiView: 'peerReview' } via bindOverviewUi's data-goto-kpi-view.
export function switchMainTab(tabId, opts = {}) {
  state.mainTab = tabId;
  if (window.AppShell) window.AppShell.setActive(tabId);
  window.scrollTo(0, 0);
  $all('#content > .tab-panel').forEach((p) => p.classList.remove('active'));
  const panel = $('#tab-' + tabId);
  if (panel) panel.classList.add('active');

  $('#timeoff-subnav').style.display = tabId === 'timeoff' ? 'flex' : 'none';

  if (tabId === 'overview') renderOverview();
  if (tabId === 'timeoff') switchSubTab(state.subTab, $('#subtab-' + state.subTab));
  if (tabId === 'team') renderTeam();
  if (tabId === 'teams') renderTeamsDirectory();
  if (tabId === 'requests') renderRequestsCenter();
  if (tabId === 'roster') renderRoster();
  if (tabId === 'kpi') renderKpi(opts.kpiView);
  if (tabId === 'users') renderUsersAdmin();
  if (tabId === 'leave-report') renderLeaveReport();
}
window.switchMainTab = switchMainTab;

// Not '/' — this page has no logged-out state of its own, so bouncing back
// here with no session just re-triggers the loginGate's harsh
// "Unauthorized" screen instead of a clean sign-in form.
async function doLogout() {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (err) {}
  window.location.href = '/login';
}

function bindUi() {
  $all('.sub-nav-tab').forEach((btn) => btn.addEventListener('click', () => switchSubTab(btn.dataset.subtab, btn)));

  bindUsersAdminUi();
  bindOverviewUi();
}

(async function init() {
  bindUi();

  const ok = await bootstrapAuth();
  if (!ok) {
    $('#loginGateChecking').hidden = true;
    $('#loginGateFail').hidden = false;
    // Not '/' — that always serves this same Employees page (see
    // src/index.js's root route), which runs this same bootstrapAuth()
    // check on load and would just fail again, right back to this screen.
    $('#btnLoginGateHome').addEventListener('click', () => { window.location.href = '/login'; });
    return;
  }

  connectRealtime(); // needs state.accessToken, which bootstrapAuth() above just set

  // Everything from here down can fail on a transient server hiccup (not
  // just a real auth problem, which the bootstrapAuth() check above already
  // handled) — without this try/catch, a failure left the page stuck on
  // "Checking your session…" forever, since nothing ever hid it or reached
  // the code that shows #app.
  try {
    const meRes = await apiFetch('/api/employees/me');
    state.myEmployee = meRes.employee;

    // "My Team" and "Teams" are always visible now — every account is
    // provisioned with an employee profile at signup (no more manual roster
    // add as a separate step), and renderTeam()/renderTeamsDirectory() both
    // already degrade gracefully (empty sections, not errors) for the rare
    // account with no employee record (e.g. one made via create-user.js).
    // Admin and P&C can both manage the roster with no employee profile at
    // all — the backend's canManageRoster grants it on auth role alone.
    const role = state.currentUser && state.currentUser.role;
    const canManageRoster = MANAGE_ROSTER_ROLES.includes(role);
    const canSeeLeaveReport = LEAVE_REPORT_ROLES.includes(role);
    const canManageUsers = USER_MANAGER_ROLES.includes(role);
    window.AppShell.mount({
      appEl: $('#app'),
      page: 'employees',
      pageLabel: 'Employees',
      role,
      items: SECTIONS,
      hidden: [
        ...(canManageRoster ? [] : ['roster']),
        ...(canSeeLeaveReport ? [] : ['leave-report']),
      ],
      onSelect: (id) => switchMainTab(id),
      onUsers: () => switchMainTab('users'),
      mountAccount: (el) => window.AccountMenu.mount(el, {
        variant: 'rail',
        apiFetch,
        currentUser: state.currentUser,
        getAccessToken: () => state.accessToken,
        onLogout: doLogout,
      }),
    });

    $('#loginGate').style.display = 'none';
    $('#app').style.display = 'grid';

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
      switchMainTab('overview');
    }
  } catch (err) {
    $('#loginGateChecking').hidden = true;
    $('#loginGateError').hidden = false;
    $('#btnLoginGateRetry').addEventListener('click', () => { window.location.reload(); });
  }
})();
