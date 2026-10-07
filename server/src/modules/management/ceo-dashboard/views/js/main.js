import { apiFetch, bootstrapAuth } from './apiClient.js';
import { loadBudget, loadEntity } from './loader.js';
import { pages, S } from './model.js';
import { session } from './session.js';
import { applyBrand, draw, goto, render } from './shell.js';
import { $ } from './util.js';

/* Server-side enforcement is the per-route role gate in ../../routes/index.js
   — this check is defense in depth for the UI only. */
const CEO_VIEW_ROLES = ['ceo', 'admin'];
// Limited view (model.js LIMITED_PAGES): the pages these roles get, each fed
// by its own narrower endpoint; /control-room answers them 403.
const LIMITED_VIEW_ROLES = ['operations', 'people_culture'];

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

/* The portal's shared sidebar (public/shared/appShell.js) carries this
   page's sections, the other pages, Users, appearance and the account;
   ⌘K stays this page's own palette (KPIs, decisions, clients), which also
   lists the portal entries. */
function mountShell(cmdOpen) {
  window.AppShell.mount({
    appEl: $('#app'),
    page: 'ceo',
    pageLabel: 'Control Room',
    role: session.currentUser.role,
    items: [],
    onSelect: (id) => goto(id),
    onSearch: cmdOpen,
    // Chart colours are read from CSS vars at draw time — redraw on change.
    onThemeChange: () => { applyBrand(); render(); },
    onResize: draw,
    mountAccount: (el) => window.AccountMenu.mount(el, {
      variant: 'rail',
      apiFetch,
      currentUser: session.currentUser,
      getAccessToken: () => session.accessToken,
      onLogout: async () => {
        try {
          await apiFetch('/api/auth/logout', { method: 'POST' });
        } catch (err) {
          // The refresh cookie is cleared server-side on a successful call; on
          // failure /login still forces a fresh sign-in, so just go there.
        }
        window.location.href = '/login';
      },
    }),
  });
}

(async function init() {
  $('#btnLoginGateHome').addEventListener('click', () => { window.location.href = '/login'; });
  $('#btnLoginGateRetry').addEventListener('click', () => { window.location.reload(); });

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
  // Listeners (keyboard shortcuts included) are only attached once there's
  // data for them to render.
  const { buildCmd, cmdOpen } = await import('./events.js');
  mountShell(cmdOpen);
  $('#loginGate').style.display = 'none';
  $('#app').style.display = 'grid';
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
