import { $, $$ } from './dom.js';
import { state } from './state.js';
import { apiFetch, bootstrapAuth } from './apiClient.js';
import { paintLogo, updateThemeToggleLabel, cycleTheme } from './theme.js';
import { renderAll } from './render.js';

/* Server-side enforcement is requireRole([ROLES.MANAGER, ROLES.ADMIN]) on
   every /api/ceo-dashboard/* route (see ../../routes/index.js) — this is
   defense in depth for the UI only. Anyone outside this set who reaches
   this page gets the same "Unauthorized" loginGate state as a failed
   login, driven by the 403 the API calls below will actually throw. */
const CEO_VIEW_ROLES = ['manager', 'admin'];
// Matches every other surface's own Users-menu-item gate.
const USER_MANAGER_ROLES = ['admin', 'manager', 'operations'];

async function loadEntity(entityKey) {
  const [snapRes, briefRes] = await Promise.all([
    apiFetch('/api/ceo-dashboard/snapshot?entity=' + encodeURIComponent(entityKey)),
    apiFetch('/api/ceo-dashboard/brief?entity=' + encodeURIComponent(entityKey)),
  ]);
  state.shell = { asOf: snapRes.snapshot.asOf, asOfLabel: snapRes.snapshot.asOfLabel, currency: snapRes.snapshot.currency, syncStatus: snapRes.snapshot.syncStatus };
  state.snapshotCache[entityKey] = snapRes.snapshot.entity;
  state.briefCache[entityKey] = briefRes.brief;
}

async function switchEntity(entityKey) {
  state.entity = entityKey;
  $$('.seg [data-ent]').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.ent === entityKey)));
  if (!state.snapshotCache[entityKey]) {
    await loadEntity(entityKey);
  }
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindUi() {
  $('#brandLogo').addEventListener('click', () => { window.location.href = '/'; });
  $('#btnLoginGateHome').addEventListener('click', () => { window.location.href = '/login'; });
  $$('.seg [data-ent]').forEach((b) => b.addEventListener('click', () => { switchEntity(b.dataset.ent); }));

  const bh = $('#briefhead');
  function toggleBrief() {
    const b = $('#brief'), open = b.dataset.open === 'true';
    b.dataset.open = String(!open); bh.setAttribute('aria-expanded', String(!open));
  }
  bh.addEventListener('click', toggleBrief);
  bh.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBrief(); } });
  $$('[data-fb]').forEach((b) => b.addEventListener('click', () => {
    $('#fbnote').textContent = 'Logged — this tunes tomorrow’s brief.';
  }));
}

(async function init() {
  updateThemeToggleLabel();
  paintLogo();
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintLogo);
  }
  bindUi();

  const ok = await bootstrapAuth();
  if (!ok || !state.currentUser || !CEO_VIEW_ROLES.includes(state.currentUser.role)) {
    $('#loginGateChecking').hidden = true;
    $('#loginGateFail').hidden = false;
    return;
  }
  const canManageUsers = USER_MANAGER_ROLES.includes(state.currentUser.role);
  window.AccountMenu.mount($('#accountMenuWrap'), {
    apiFetch,
    currentUser: state.currentUser,
    getAccessToken: () => state.accessToken,
    canManageUsers,
    onUsersClick: () => { window.location.href = '/?open=users'; },
    onLogout: async () => {
      try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (err) {}
      window.location.href = '/login';
    },
    cycleTheme,
    updateThemeToggleLabel,
    // Chart colors are read live from CSS vars at draw time — redraw so
    // they pick up the new theme instead of staying stuck on the old one.
    onThemeChange: renderAll,
  });
  $('#loginGate').style.display = 'none';
  $('#app').style.display = 'block';

  try {
    await loadEntity(state.entity);
    renderAll();
  } catch (err) {
    /* Most commonly a 403 — authenticated, but not manager (requireRole on
       the server). Falls back to the same "Unauthorized" state as a failed
       login rather than an empty, broken-looking dashboard. */
    $('#app').style.display = 'none';
    $('#loginGate').style.display = 'flex';
    $('#loginGateChecking').hidden = true;
    $('#loginGateFail').hidden = false;
  }
})();
