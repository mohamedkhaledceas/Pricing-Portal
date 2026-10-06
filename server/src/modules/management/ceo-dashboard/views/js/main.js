import { apiFetch, bootstrapAuth } from './apiClient.js';
import { loadBudget, loadEntity } from './loader.js';
import { pages, S } from './model.js';
import { session } from './session.js';
import { applyBrand, render } from './shell.js';
import { setTheme, syncThemeChip, updateAppearanceControls } from './theme.js';
import { $ } from './util.js';

/* Server-side enforcement is the per-route role gate in ../../routes/index.js
   — this check is defense in depth for the UI only. */
const CEO_VIEW_ROLES = ['ceo', 'admin'];
// Limited view (model.js LIMITED_PAGES): the pages these roles get, each fed
// by its own narrower endpoint; /control-room answers them 403.
const LIMITED_VIEW_ROLES = ['operations', 'people_culture'];
// Matches every other surface's own Users-menu-item gate.
const USER_MANAGER_ROLES = ['admin', 'ceo', 'operations'];

function showGate(which, message) {
  $('#app').style.display = 'none';
  $('#loginGate').style.display = 'flex';
  $('#loginGateChecking').hidden = true;
  if (which === 'error') {
    $('#loginGateError').querySelector('p').textContent = message || "Couldn't load the dashboard.";
    $('#loginGateError').hidden = false;
  } else {
    $('#loginGateFail').hidden = false;
  }
}

function mountAccountMenu() {
  window.AccountMenu.mount($('#accountMenuWrap'), {
    apiFetch,
    currentUser: session.currentUser,
    getAccessToken: () => session.accessToken,
    canManageUsers: USER_MANAGER_ROLES.includes(session.currentUser.role),
    onUsersClick: () => { window.location.href = '/?open=users'; },
    onLogout: async () => {
      try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
      } catch (err) {
        // The refresh cookie is cleared server-side on a successful call; on
        // failure /login still forces a fresh sign-in, so just go there.
      }
      window.location.href = '/login';
    },
    setTheme,
    updateAppearanceControls,
    // Chart colours are read from CSS vars at draw time — redraw on change.
    onThemeChange: () => { syncThemeChip(); applyBrand(); render(); },
  });
}

(async function init() {
  $('#btnLoginGateHome').addEventListener('click', () => { window.location.href = '/login'; });
  $('#btnLoginGateRetry').addEventListener('click', () => { window.location.reload(); });
  syncThemeChip();

  const ok = await bootstrapAuth();
  const role = ok && session.currentUser ? session.currentUser.role : null;
  if (!CEO_VIEW_ROLES.includes(role) && !LIMITED_VIEW_ROLES.includes(role)) {
    showGate('fail');
    return;
  }
  S.role = role;
  S.scope = CEO_VIEW_ROLES.includes(role) ? 'full' : 'limited';
  // Open on the function this role owns (P&C's People & Culture is already the default).
  if (role === 'operations') S.fn = 'ops';

  try {
    if (S.scope === 'limited') await loadBudget();
    else await loadEntity(S.ent);
  } catch (err) {
    // A 401/403 is a permissions problem; anything else (500, network) is a
    // load failure and says so rather than claiming "Unauthorized".
    if (err.status === 401 || err.status === 403) showGate('fail');
    else showGate('error', err.message);
    return;
  }
  mountAccountMenu();
  $('#loginGate').style.display = 'none';
  $('#app').style.display = 'grid';

  // Listeners (keyboard shortcuts included) are only attached once there's
  // data for them to render.
  const { buildCmd } = await import('./events.js');
  applyBrand();
  if (S.scope === 'limited') {
    $('.samplebar').innerHTML = '<div><b>Budget.</b> These are the starting budget figures from the workbook. '
      + 'You can change the plan for the functions you own; every change is saved and logged.'
      + (pages().some((p) => p.id === 'clients') ? ' The client book is live from Odoo and ClickUp.' : '') + '</div>';
  }
  const hash = (location.hash || '').slice(1);
  S.page = pages().some((p) => p.id === hash) ? hash : pages()[0].id;
  if (hash && hash !== S.page) history.replaceState(null, '', '#' + S.page);
  buildCmd();
  render();
})();
