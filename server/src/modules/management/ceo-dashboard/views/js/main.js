import { $, $$ } from './dom.js';
import { state } from './state.js';
import { apiFetch, bootstrapAuth } from './apiClient.js';
import { paintLogo, updateAppearanceControls, setTheme } from './theme.js';
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
  $('#btnLoginGateRetry').addEventListener('click', () => { window.location.reload(); });
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
  updateAppearanceControls();
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
    setTheme,
    updateAppearanceControls,
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
    // A real 401/403 means authenticated but not manager (requireRole on
    // the server) — that's genuinely "Unauthorized". Anything else (a 500,
    // a network drop) is a load failure, not a permissions problem, and
    // showing "Unauthorized" for it misleads whoever's debugging — this
    // now tells the two apart instead of always falling back to the same
    // screen as a failed login.
    $('#app').style.display = 'none';
    $('#loginGate').style.display = 'flex';
    $('#loginGateChecking').hidden = true;
    if (err.status === 401 || err.status === 403) {
      $('#loginGateFail').hidden = false;
    } else {
      $('#loginGateError').querySelector('p').textContent = err.message || "Couldn't load the dashboard.";
      $('#loginGateError').hidden = false;
    }
  }
})();
