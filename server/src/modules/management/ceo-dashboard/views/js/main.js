import { apiFetch, bootstrapAuth } from './apiClient.js';
import { loadEntity } from './loader.js';
import { PAGES, S } from './model.js';
import { session } from './session.js';
import { applyBrand, render } from './shell.js';
import { setTheme, syncThemeChip, updateAppearanceControls } from './theme.js';
import { $ } from './util.js';

/* Server-side enforcement is requireRole([ROLES.CEO, ROLES.ADMIN]) on every
   /api/ceo-dashboard/* route (see ../../routes/index.js) — this check is
   defense in depth for the UI only. */
const CEO_VIEW_ROLES = ['ceo', 'admin'];
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
  if (!ok || !session.currentUser || !CEO_VIEW_ROLES.includes(session.currentUser.role)) {
    showGate('fail');
    return;
  }

  try {
    await loadEntity(S.ent);
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
  const hash = (location.hash || '#focus').slice(1);
  S.page = PAGES.some((p) => p.id === hash) ? hash : 'focus';
  buildCmd();
  render();
})();
