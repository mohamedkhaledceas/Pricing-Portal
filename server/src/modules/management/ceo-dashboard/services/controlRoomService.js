/* Builds the CEO Control Room payload: the prototype's data shape (the `D`
   object the frontend renders) with every block that has a real source
   overwritten. One payload per view (Ceas Comm, FZE, LWM, All), because
   Odoo's figures are per company. The overlays themselves live in
   ./overlays/ (one file per area, pure); this file decides which run for
   which view, in what order, and what happens when one fails.

   Live sources, each read through its owner's public interface:
   finance (management/finance: revenue, receivables, collections, P&L,
   balance sheet, cash, years, sales orders, payables — per company; All =
   Odoo's own conversions where verified), pipeline (commercial-leads),
   delivery (management/delivery, ClickUp), people (employees), costs
   (Margin Planner, Ceas Comm only), and what the page saves (budgets,
   targets, escalation — phase 3).

   A source that fails is marked unavailable (its KPIs blank, its panels
   say so) — never left on sample figures. `sources` tells the page which
   blocks are live; `sync` and the Odoo self-checks drive the sync chip. */
const { ValidationError } = require('../../../../common/errors');

const CAIRO_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
const CAIRO_LONG_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const CAIRO_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' });
const CAIRO_DAY_MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' });

const ENTITY_LIST = Object.freeze([
  // `short` labels the top-bar switcher, which has to fit on one line.
  { key: 'ceas', name: 'Ceas Comm', short: 'Ceas Comm', currency: 'EGP', note: 'Odoo company Ceas Comm (Egypt).' },
  { key: 'fze', name: 'Ceas Comm FZE', short: 'FZE', currency: 'AED', note: 'Odoo company Ceas Comm FZE (UAE), in AED.' },
  { key: 'lwm', name: 'Learn with Marie', short: 'LWM', currency: 'EGP', note: 'Odoo company Learn With Marie.' },
  { key: 'all', name: 'Consolidated', short: 'All', currency: 'EGP', note: 'All companies, in Odoo\'s own EGP conversion. Cash, balance sheet and payables are shown per company.' },
]);

const { LIVE_FINANCE_KPIS, applyFinance, applyConsolidatedRevenue } = require('./overlays/finance');
const { applyPnl, applyBalance, applyYears, currentYearOnly } = require('./overlays/statements');
const { applySales } = require('./overlays/sales');
const { applyDelivery } = require('./overlays/delivery');
const { applyBudgets, applyTargets } = require('./overlays/saved');
const { applyPipeline, applyPeople } = require('./overlays/workforce');

// KPIs each live source fills — blanked, not left on sample, when it fails.
const SOURCE_KPIS = {
  finance: LIVE_FINANCE_KPIS,
  pnl: ['gross_margin', 'net_margin', 'net_profit', 'opex_ratio'],
  balance: ['cash_balance', 'cash_runway'],
  sales: ['backlog', 'avg_deal_size'],
  delivery: ['overdue_tasks'],
};

// A sync that runs every 15 minutes is stale once its last good copy is older than this.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

function createControlRoomService({
  sampleRepository, budgetService, targetService, escalationService, financeMetricsService, getPipelineSummary, getWorkforceSummary,
  getDeliverySummary, listDataChecks, getCompanyCostSummary,
  logger, now = () => new Date(),
}) {
  function entityOrThrow(entityKey) {
    const entity = ENTITY_LIST.find((e) => e.key === entityKey);
    if (!entity) throw new ValidationError(`Unknown entity "${entityKey}".`);
    return entity;
  }

  /* Runs one source's overlay; on failure the block stays sample. */
  /* Runs one source's overlay. On failure the source is marked
     unavailable — its KPIs show "—" and the page shows "unavailable" in
     place of its panels — never the sample's invented figures. */
  function overlay(D, source, fn, sources) {
    try {
      fn();
      return true;
    } catch (error) {
      logger.error('Control Room: live read failed — source marked unavailable', { source, error: error.message });
      sources[source] = 'error';
      D.unavailable = { ...(D.unavailable || {}), [source]: true };
      for (const id of SOURCE_KPIS[source] || []) {
        const k = D.kpis.find((x) => x.id === id);
        if (k) Object.assign(k, { live: false, unavailable: true, actual: null, source: 'Unavailable' });
        delete D.series[id];
        delete D.yearMap[id];
      }
      return false;
    }
  }

  /* `at` is short for the top-bar chip: the time for a sync earlier today,
     the date otherwise. */
  function syncLines(todayIso, D) {
    const stamp = (iso) => {
      const last = iso ? new Date(iso) : null;
      if (!last) return null;
      return CAIRO_DATE.format(last) === todayIso ? CAIRO_TIME.format(last) : CAIRO_DAY_MONTH.format(last);
    };
    // "stale": the last good copy is too old — the sync keeps failing or stopped.
    const state = (status, iso) => (status === 'ok' && iso && now() - new Date(iso) > STALE_AFTER_MS ? 'stale' : status);
    const odoo = financeMetricsService.getSyncStatus();
    const delivery = D.deliveryLive && D.deliveryLive.sync;
    return [
      { source: 'Odoo', status: state(odoo.status, odoo.lastSuccessAt), at: stamp(odoo.lastSuccessAt) },
      ...(delivery ? [{ source: 'ClickUp delivery', status: state(delivery.lastStatus || 'never', delivery.lastSuccessAt), at: stamp(delivery.lastSuccessAt) }] : []),
      // Commercial Lead's cache is pushed by ClickUp webhooks plus a
      // reconciliation job; it has no single "last synced" stamp to show.
      { source: 'ClickUp', status: 'ok', at: null, note: 'webhooks' },
    ];
  }

  function getControlRoom(entityKey) {
    const entity = entityOrThrow(entityKey);
    const today = now();
    const todayIso = CAIRO_DATE.format(today);
    const D = structuredClone(sampleRepository.getSample());
    const sources = { finance: 'sample', pnl: 'sample', balance: 'sample', payables: 'sample', delivery: 'sample', sales: 'sample', pipeline: 'sample', people: 'sample', costs: 'sample' };

    D.asOf = todayIso;
    D.asOfLabel = CAIRO_LONG_DATE.format(today);
    D.entity = entity;
    D.entityList = ENTITY_LIST;
    D.currency = entity.currency;

    overlay(D, 'budget', () => applyBudgets(D, budgetService.getState()), sources);

    if (financeMetricsService.isFinanceEntity(entity.key)) {
      overlay(D, 'finance', () => {
        applyFinance(D, financeMetricsService.getEntityFinance(entity.key), entity);
        sources.finance = 'odoo';
      }, sources);
    } else if (entity.key === 'all') {
      overlay(D, 'finance', () => {
        applyConsolidatedRevenue(D, financeMetricsService.getConsolidatedRevenue());
        sources.finance = 'odoo';
      }, sources);
    }
    if (financeMetricsService.isFinanceEntity(entity.key) || entity.key === 'all') {
      overlay(D, 'pnl', () => {
        applyPnl(D, financeMetricsService.getProfitAndLoss(entity.key));
        sources.pnl = 'odoo';
      }, sources);
      if (entity.key !== 'all') {
        overlay(D, 'balance', () => {
          applyBalance(D, financeMetricsService.getBalanceSheet(entity.key));
          sources.balance = 'odoo';
        }, sources);
        overlay(D, 'years', () => {
          applyYears(D, financeMetricsService.getYearHistory(entity.key));
          sources.years = 'odoo';
        }, sources);
        overlay(D, 'payables', () => {
          // Bills whose vendor is the company itself are flagged on the page.
          D.payablesLive = { ...financeMetricsService.getPayables(entity.key), companyName: entity.name };
          sources.payables = 'odoo';
        }, sources);
      }
      overlay(D, 'sales', () => {
        applySales(D, financeMetricsService.getSalesSummary(entity.key));
        sources.sales = 'odoo';
      }, sources);
    }
    overlay(D, 'pipeline', () => {
      applyPipeline(D, getPipelineSummary());
      sources.pipeline = 'clickup';
    }, sources);
    overlay(D, 'delivery', () => {
      applyDelivery(D, getDeliverySummary());
      sources.delivery = 'clickup';
    }, sources);
    overlay(D, 'people', () => {
      applyPeople(D, getWorkforceSummary({ today: todayIso }));
      sources.people = 'portal';
    }, sources);
    if (entity.key === 'ceas') {
      overlay(D, 'costs', () => {
        D.costs = getCompanyCostSummary();
        sources.costs = 'planner';
      }, sources);
    }
    // Unreadable saved targets → no targets, never the prototype's invented ones.
    if (!overlay(D, 'targets', () => applyTargets(D, targetService.getState(entity.key)), sources)) {
      for (const k of D.kpis) k.target = null;
    }
    // Saved escalation preferences (company-wide); the page copies them into its state.
    overlay(D, 'escalation', () => { D.prefs = escalationService.getPrefs(); }, sources);

    // A view without an Odoo year history never shows the sample's invented years.
    if (!D.yearsLive) currentYearOnly(D, todayIso);

    // The sample's own sync lines are invented times — never shown.
    D.sync = [];
    overlay(D, 'sync', () => { D.sync = syncLines(todayIso, D); }, sources);
    // Self-checks run after each full Odoo copy; only failing ones are shown.
    overlay(D, 'checks', () => { D.dataChecks = listDataChecks().filter((c) => c.status !== 'ok'); }, sources);

    D.sources = sources;
    return D;
  }

  /* The Budget tab alone — for operations and people_culture, who may see
     nothing else on this page. Only the blocks the Budget tab renders are
     copied out, so revenue, clients, cash, people and payroll-by-person
     never leave the server for these roles. net_profit is the one KPI
     the tab shows. */
  function getBudget() {
    const today = now();
    const sample = sampleRepository.getSample();
    const netProfit = sample.kpis.find((k) => k.id === 'net_profit');
    const D = structuredClone({
      scope: 'budget',
      asOf: CAIRO_DATE.format(today),
      asOfLabel: CAIRO_LONG_DATE.format(today),
      currency: 'EGP',
      months2: sample.months2,
      elapsed: sample.elapsed,
      penalty: sample.penalty,
      budget: sample.budget,
      fnBudget: sample.fnBudget,
      functions: sample.functions,
      projects: { value: sample.projects.value, margin: sample.projects.margin },
      pnl: { netProfit: sample.pnl.netProfit },
      revenue: { ytd: sample.revenue.ytd, ytdTarget: sample.revenue.ytdTarget },
      kpis: [netProfit],
      series: {},
      yearMap: {},
      years: {},
      records: {},
      risks: [],
      decisions: [],
      components: [],
      sources: {},
      sync: [],
    });
    try {
      applyBudgets(D, budgetService.getState());
    } catch (error) {
      // Same rule as the Control Room's overlays: show the workbook figures rather than fail.
      logger.error('Budget tab: saved budgets unreadable — showing the workbook figures', { error: error.message });
    }
    return D;
  }

  return { getControlRoom, getBudget };
}

module.exports = createControlRoomService;
