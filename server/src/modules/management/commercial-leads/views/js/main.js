import { $, skeletonBlock, skeletonTableRows } from './dom.js';
import { state } from './state.js';
import { apiFetch, bootstrapAuth } from './apiClient.js';
import { paintLogo, updateThemeToggleLabel, cycleTheme } from './theme.js';
import { renderStats } from './charts.js';
import { renderStageDurations } from './stageDurations.js';
import { renderQuarterlyKpis, bindQuarterlyUi } from './quarterlyKpis.js';
import { renderPipelineTable, renderActiveClientsTable, bindDealsUi } from './deals.js';
import { connectSocket } from './realtime.js';

const USER_MANAGER_ROLES = ['admin', 'manager', 'operations'];

function renderDashboardSkeletons() {
  $('#qkGrid').innerHTML = Array.from({ length: 8 }, () => `
    <div class="kpi-tile">
      ${skeletonBlock('44px', '24px')}
      <div style="margin-top:8px;">${skeletonBlock('70%', '12px')}</div>
    </div>
  `).join('');
  ['chartStatus', 'chartSource', 'chartBusinessLine', 'chartCountry'].forEach((id) => {
    $('#' + id).innerHTML = Array.from({ length: 4 }, () => `<div style="margin:6px 0;">${skeletonBlock('100%', '16px')}</div>`).join('');
  });
  document.querySelector('#pipelineTable tbody').innerHTML = skeletonTableRows(['85%', '60%', '70%', '50%', '60%']);
  document.querySelector('#activeClientsTable tbody').innerHTML = skeletonTableRows(['85%', '60%']);
}

async function loadAll() {
  const [dealsRes, statsRes, durationsRes, statusColorsRes, quarterlyRes] = await Promise.all([
    apiFetch('/api/commercial-lead/deals'),
    apiFetch('/api/commercial-lead/stats?days=30'),
    apiFetch('/api/commercial-lead/stage-durations'),
    apiFetch('/api/commercial-lead/status-colors'),
    apiFetch('/api/commercial-lead/quarterly-kpis'),
  ]);
  state.dealsCache = dealsRes.deals;
  state.statusColors = statusColorsRes.statusColors;
  renderPipelineTable();
  renderActiveClientsTable();
  renderStats(statsRes.stats);
  renderStageDurations(durationsRes.stageDurations);
  renderQuarterlyKpis(quarterlyRes);
}

let statsRefreshTimer = null;
function scheduleStatsRefresh() {
  clearTimeout(statsRefreshTimer);
  statsRefreshTimer = setTimeout(() => {
    apiFetch('/api/commercial-lead/stats?days=30').then((r) => renderStats(r.stats)).catch(() => {});
    apiFetch('/api/commercial-lead/stage-durations').then((r) => renderStageDurations(r.stageDurations)).catch(() => {});
  }, 1500);
}

function bindUi() {
  $('#brandLogo').addEventListener('click', () => { window.location.href = '/'; });
  $('#btnLoginGateHome').addEventListener('click', () => { window.location.href = '/'; });
  $('#btnAccountMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#accountMenu');
    menu.hidden = !menu.hidden;
    $('#btnAccountMenu').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', () => { $('#accountMenu').hidden = true; });
  $('#btnThemeToggle').addEventListener('click', (e) => { e.stopPropagation(); cycleTheme(); });
  $('#btnAccountSettings').addEventListener('click', () => { window.location.href = '/?open=accountSettings'; });
  $('#btnUsersView').addEventListener('click', () => { window.location.href = '/?open=users'; });
  $('#btnLogout').addEventListener('click', async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (err) {}
    // Not '/' — this page has no logged-out state of its own, so bouncing
    // back here with no session just re-triggers the loginGate's harsh
    // "Unauthorized" screen instead of a clean sign-in form.
    window.location.href = '/login';
  });

  bindDealsUi();
  bindQuarterlyUi();
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
  $('#btnUsersView').hidden = !state.currentUser || !USER_MANAGER_ROLES.includes(state.currentUser.role);
  $('#accountMenuEmail').textContent = state.currentUser ? state.currentUser.email || '' : '';
  $('#loginGate').style.display = 'none';
  $('#app').style.display = 'block';
  renderDashboardSkeletons();
  try {
    await loadAll();
  } catch (err) {
    /* Most commonly a 403 — authenticated, but not manager/operations/admin
       (requireRole on the server, see modules/management/commercial-leads/
       routes/index.js). Falls back to the same "Unauthorized" state as an
       outright failed login rather than leaving the skeletons stuck
       loading forever with no explanation. */
    $('#app').style.display = 'none';
    $('#loginGate').style.display = 'flex';
    $('#loginGateChecking').hidden = true;
    $('#loginGateFail').hidden = false;
    return;
  }
  connectSocket({ onEvent: scheduleStatsRefresh });
})();
