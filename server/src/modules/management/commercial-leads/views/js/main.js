import { $, skeletonBlock, skeletonTableRows } from './dom.js';
import { state } from './state.js';
import { apiFetch, bootstrapAuth } from './apiClient.js';
import { renderStats } from './charts.js';
import { renderStageDurations } from './stageDurations.js';
import { renderQuarterlyKpis, bindQuarterlyUi } from './quarterlyKpis.js';
import { renderPipelineTable, renderActiveClientsTable, bindDealsUi } from './deals.js';
import { connectSocket } from './realtime.js';

// The sidebar's sections (shared shell, public/shared/appShell.js) — this
// is one scrolling page, so each scrolls to its block.
const SECTIONS = [
  { id: 'sec-quarter', label: 'This quarter', icon: 'targets' },
  { id: 'sec-mix', label: 'Pipeline mix', icon: 'report' },
  { id: 'sec-deals', label: 'Live deals', icon: 'list' },
  { id: 'sec-active', label: 'Active clients', icon: 'clients' },
];

/* Highlights the section whose block is nearest the top of the screen. */
function trackSections() {
  if (!('IntersectionObserver' in window)) return;
  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => seen.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : null));
    const current = SECTIONS.map((t) => [t.id, seen.get(t.id)]).filter(([, top]) => top != null)
      .sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0];
    if (current) window.AppShell.setActive(current[0]);
  }, { rootMargin: '-64px 0px -55% 0px' });
  SECTIONS.forEach((t) => { const el = document.getElementById(t.id); if (el) io.observe(el); });
}

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
  bindUi();

  const ok = await bootstrapAuth();
  if (!ok) {
    $('#loginGateChecking').hidden = true;
    $('#loginGateFail').hidden = false;
    return;
  }
  window.AppShell.mount({
    appEl: $('#app'),
    page: 'commercial-lead',
    pageLabel: 'Commercial Lead',
    role: state.currentUser && state.currentUser.role,
    items: SECTIONS,
    active: SECTIONS[0].id,
    onSelect: (id) => {
      window.AppShell.setActive(id);
      document.getElementById(id).scrollIntoView({ block: 'start' });
    },
    mountAccount: (el) => window.AccountMenu.mount(el, {
      variant: 'rail',
      apiFetch,
      currentUser: state.currentUser,
      getAccessToken: () => state.accessToken,
      onLogout: async () => {
        try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (err) {}
        window.location.href = '/login';
      },
    }),
  });
  $('#loginGate').style.display = 'none';
  $('#app').style.display = 'grid';
  trackSections();
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
