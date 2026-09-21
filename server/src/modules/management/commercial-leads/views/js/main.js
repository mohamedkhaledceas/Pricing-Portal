import { $, skeletonBlock, skeletonTableRows } from './dom.js';
import { state } from './state.js';
import { apiFetch, bootstrapAuth } from './apiClient.js';
import { paintLogo, updateAppearanceControls, setTheme } from './theme.js';
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
  // Not '/' — that always serves the Employees page (see src/index.js's
  // root route), which runs its own bootstrapAuth() check on load and
  // would just fail again with the same session gone, right back to an
  // "Unauthorized" screen instead of anywhere useful.
  $('#btnLoginGateHome').addEventListener('click', () => { window.location.href = '/login'; });
  $('#btnLoginGateRetry').addEventListener('click', () => { window.location.reload(); });
  bindDealsUi();
  bindQuarterlyUi();
}

(async function init() {
  updateAppearanceControls();
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
  const canManageUsers = state.currentUser && USER_MANAGER_ROLES.includes(state.currentUser.role);
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
  });
  $('#loginGate').style.display = 'none';
  $('#app').style.display = 'block';
  renderDashboardSkeletons();
  try {
    await loadAll();
  } catch (err) {
    // A real 401/403 means authenticated but not manager/operations/admin
    // (requireRole on the server, see modules/management/commercial-leads/
    // routes/index.js) — that's genuinely "Unauthorized". Anything else
    // (a 500, a network drop, ClickUp sync being mid-run) is a load
    // failure, not a permissions problem, and showing "Unauthorized" for
    // it misleads whoever's debugging — this now tells the two apart
    // instead of leaving the skeletons stuck loading with no explanation.
    $('#app').style.display = 'none';
    $('#loginGate').style.display = 'flex';
    $('#loginGateChecking').hidden = true;
    if (err.status === 401 || err.status === 403) {
      $('#loginGateFail').hidden = false;
    } else {
      $('#loginGateError').querySelector('p').textContent = err.message || "Couldn't load the dashboard.";
      $('#loginGateError').hidden = false;
    }
    return;
  }
  connectSocket({ onEvent: scheduleStatsRefresh });
})();
