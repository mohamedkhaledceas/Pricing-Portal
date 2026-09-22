import { $, $$, setApplyModeHandler, setRenderAllHandler, recompute } from './dom.js';
import { state, USER_MANAGER_ROLES, hashPin, isBD } from './state.js';
import { attemptSilentRefresh, apiRequest, getStoredAuth, setStoredAuth, setSessionExpiredHandler, logoutFromApi } from './apiClient.js';
import { bindTheme, setTheme, updateAppearanceControls, paintLogos } from './theme.js';
import { thisMonth, projectCalc } from './calc.js';
import { renderTeam, bindTeamTable } from './team.js';
import { renderExpenses, bindExpensesTable } from './expenses.js';
import {
  renderCurrencyUI, loadSettingsInputs, bindSettings, bindFiles, hydrateFromApi,
} from './settingsPanel.js';
import { loadUsersTable, bindUsersView } from './users.js';
import { renderProjectSelects, renderProject, bindProjectsTable } from './projects.js';
import { bindHistory } from './history.js';
import { renderScenarios, bindScenariosTable } from './scenarios.js';
import { renderQuoteInputs, bindQuoteTable } from './quote.js';
import { bindCapacityInputs } from './capacity.js';
import './recompute.js';

/* Entry point for the margin-planner refactor (see the refactor plan) —
   every tab is now wired: Dashboard/Capacity have no dedicated render
   functions of their own (same shape in the original — both compute-and-
   paint directly inside recompute()/renderCapacity(), called every
   recompute() pass, so nothing extra is needed in renderAllStructuresImpl()
   below beyond the recompute() call already there). */

function selectTab(name) {
  $$('nav.tabs button').forEach((x) => x.setAttribute('aria-selected', x.dataset.tab === name ? 'true' : 'false'));
  $$('section.tabpanel').forEach((s) => { s.hidden = true; });
  $('#tab-' + name).hidden = false;
}
function bindTabs() {
  $$('nav.tabs button').forEach((b) => b.addEventListener('click', () => {
    selectTab(b.dataset.tab);
    window.scrollTo({ top: 0 });
  }));
}

function applyModeImpl() {
  const bd = isBD();
  document.body.setAttribute('data-mode', bd ? 'bd' : 'admin');
  $('#appSub').textContent = bd ? 'Build an estimate and check the price'
    : 'Salaries → true hourly cost → project margins';
  const onUsersTab = !$('#tab-users').hidden;
  const active = $('nav.tabs button[aria-selected="true"]');
  if (bd && !onUsersTab && (!active || active.classList.contains('admin-only'))) selectTab('projects');
}
function setMode(m) { state.ui.mode = m; applyModeImpl(); renderAllStructuresImpl(); }

function renderAllStructuresImpl() {
  paintLogos();
  renderCurrencyUI();
  renderTeam(); renderExpenses(); renderProjectSelects(); renderProject();
  renderScenarios(); renderQuoteInputs();
  recompute();
}

setApplyModeHandler(applyModeImpl);
setRenderAllHandler(renderAllStructuresImpl);

function openUsersView() {
  selectTab('users');
  loadUsersTable();
  window.scrollTo({ top: 0 });
}

function bindModes() {
  $('#btnLock').addEventListener('click', () => {
    if (!state.security.pinHash) {
      alert('Set a PIN first, in Settings → Team (BD) view. Without one, anyone can switch straight back.');
      selectTab('settings'); return;
    }
    setMode('bd');
  });
  $('#btnUnlock').addEventListener('click', () => {
    const v = prompt('PIN to return to the owner view:');
    if (v === null) return;
    if (state.security.pinHash && hashPin(v) === state.security.pinHash) setMode('admin');
    else alert('That PIN is not right.');
  });
}

function bindNavButtons() {
  $('#brandLogo').addEventListener('click', () => { window.scrollTo({ top: 0 }); });
  $('#btnEmployees').addEventListener('click', () => { window.location.href = '/'; });
  $('#btnCommercialLead').addEventListener('click', () => { window.location.href = '/commercial-lead'; });
  $('#btnLoadErrorRetry').addEventListener('click', () => { window.location.reload(); });
}

/* Auth now lives on its own page (/login) — a visitor with no live session
   is sent there directly rather than shown an embedded form. */
function updateLoginUi() {
  const auth = getStoredAuth();
  const isLoggedIn = !!(auth && auth.token);
  if (!isLoggedIn) {
    window.location.href = '/login';
    return;
  }
  const appShell = $('#appShell');
  $('#btnLogin').hidden = true;
  if (auth.user) {
    $('#btnCommercialLead').hidden = !USER_MANAGER_ROLES.includes(auth.user.role);
    window.AccountMenu.mount($('#accountMenuWrap'), {
      apiFetch: apiRequest,
      currentUser: auth.user,
      getAccessToken: () => getStoredAuth().token,
      canManageUsers: USER_MANAGER_ROLES.includes(auth.user.role),
      onUsersClick: openUsersView,
      onLogout: async () => { await logoutFromApi(); window.location.href = '/login'; },
      setTheme,
      updateAppearanceControls,
    });
  }
  appShell.hidden = false;
  appShell.style.display = '';
}

$('#btnLogin').addEventListener('click', () => { window.location.href = '/login'; });

setSessionExpiredHandler(() => { window.location.href = '/login'; });

/* sample scenarios expressed as a % of the project price are resolved once, on load */
state.projects.forEach((pr) => {
  const base = projectCalc(pr).price;
  (pr.scenarios || []).forEach((s) => { if (s._pct) { s.price = Math.round(base * s._pct); delete s._pct; } });
});

bindTabs();
bindTeamTable();
bindExpensesTable();
bindProjectsTable();
bindHistory();
bindScenariosTable();
bindQuoteTable();
bindCapacityInputs();
bindSettings();
bindFiles();
bindModes();
bindTheme();
bindNavButtons();
bindUsersView();
$('#fitStart').value = thisMonth();

/* No persisted cache to render from instantly — access tokens are memory-
   only (see apiClient.js), so every fresh load has to wait on one
   silent-refresh round trip before it knows whether there's a live
   session, same as /employees and /commercial-lead already do.
   updateLoginUi() sends the visitor to /login if that comes back empty. */
(async () => {
  const refreshed = await attemptSilentRefresh();
  if (refreshed && refreshed.token) setStoredAuth(refreshed.token, refreshed.user);
  updateLoginUi();
  loadSettingsInputs(); applyModeImpl(); renderAllStructuresImpl();

  const auth = getStoredAuth();
  if (!auth || !auth.token) return;

  /* Lets other pages sharing this backend deep-link into a specific view
     rather than duplicating it — visit /?open=accountSettings, /?open=users,
     /?open=team, or /?open=expenses and, if permitted, that view opens
     immediately. Strips the param afterward so a manual refresh doesn't keep
     reopening it. */
  const params = new URLSearchParams(window.location.search);
  const open = params.get('open');
  if (open) {
    if (open === 'accountSettings') {
      // Fixed pre-existing bug: the original called a bare `openAccountSettings()`
      // that was never defined anywhere in the file — this is the actual
      // working call, already used correctly by accountMenu.js itself.
      window.AccountMenu.openSettings({
        apiFetch: apiRequest,
        currentUser: auth.user,
        getAccessToken: () => getStoredAuth().token,
        canManageUsers: USER_MANAGER_ROLES.includes(auth.user.role),
        onUsersClick: openUsersView,
        onLogout: async () => { await logoutFromApi(); window.location.href = '/login'; },
        setTheme,
        updateAppearanceControls,
      });
    } else if (open === 'users' && USER_MANAGER_ROLES.includes(auth.user.role)) openUsersView();
    else if (open === 'team') selectTab('team');
    else if (open === 'expenses') selectTab('expenses');
    params.delete('open');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
  }

  /* `state` above is still local sample/demo data with client-only ids —
     none of it has been confirmed against the database yet. Re-hydrate from
     the server before the user can touch anything, so every id on screen is
     a real, editable server id. */
  const ok = await hydrateFromApi();
  if (!ok) {
    const stillAuthed = !!(getStoredAuth() && getStoredAuth().token);
    if (stillAuthed) {
      $('#loadErrorOverlay').hidden = false;
    }
  }
})();
