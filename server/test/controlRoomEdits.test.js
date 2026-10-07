/* Who may change what on the Control Room — enforced in the services,
   tested with plain fakes (the DI factories take them directly). */
const test = require('node:test');
const assert = require('node:assert/strict');
const createBudgetService = require('../src/modules/management/ceo-dashboard/services/budgetService');
const createTargetService = require('../src/modules/management/ceo-dashboard/services/targetService');
const createEscalationService = require('../src/modules/management/ceo-dashboard/services/escalationService');

const fakeAudit = () => { const log = []; return { log, record: (e) => log.push(e) }; };
const actor = (role) => ({ id: 1, role });
const status = (fn) => { try { fn(); return 200; } catch (e) { return e.statusCode; } };

function budgetSetup() {
  const audit = fakeAudit();
  const plans = new Map([['ops|Adobe|0', 100], ['people|Bonuses|0', 200], ['hiring|Sales|0', 300], ['marketing|Events|0', 400]]);
  const repo = {
    findLine: (y, name) => (name === 'Payroll' ? { id: 1, annual: 1000 } : null),
    updateLine: () => {},
    findPlan: (y, f, c, m) => (plans.has(`${f}|${c}|${m}`) ? { id: 2, amount: plans.get(`${f}|${c}|${m}`) } : null),
    updatePlan: () => {},
  };
  return { svc: createBudgetService({ budgetRepository: repo, audit }), audit };
}

test('function plans: each role edits only the functions it owns', () => {
  const { svc } = budgetSetup();
  const edit = (role, functionId, category) => status(() => svc.updatePlan({ actor: actor(role), functionId, category, month: 0, amount: 1 }));
  assert.equal(edit('operations', 'ops', 'Adobe'), 200);
  assert.equal(edit('operations', 'people', 'Bonuses'), 403);
  assert.equal(edit('people_culture', 'people', 'Bonuses'), 200);
  assert.equal(edit('people_culture', 'hiring', 'Sales'), 200);
  assert.equal(edit('people_culture', 'ops', 'Adobe'), 403);
  assert.equal(edit('operations', 'marketing', 'Events'), 403);
  assert.equal(edit('ceo', 'marketing', 'Events'), 200);
  assert.equal(edit('employee', 'ops', 'Adobe'), 403);
});

test('P&L-line budgets: ceo/admin only, whole non-negative amounts, unchanged writes nothing', () => {
  const { svc, audit } = budgetSetup();
  assert.equal(status(() => svc.updateLine({ actor: actor('operations'), name: 'Payroll', annual: 5 })), 403);
  assert.equal(status(() => svc.updateLine({ actor: actor('ceo'), name: 'Payroll', annual: -5 })), 400);
  assert.equal(status(() => svc.updateLine({ actor: actor('ceo'), name: 'Payroll', annual: 1.5 })), 400);
  assert.equal(status(() => svc.updateLine({ actor: actor('ceo'), name: 'Nope', annual: 5 })), 404);
  svc.updateLine({ actor: actor('ceo'), name: 'Payroll', annual: 1000 });
  assert.equal(audit.log.length, 0);
  svc.updateLine({ actor: actor('admin'), name: 'Payroll', annual: 1200 });
  assert.equal(audit.log.length, 1);
  assert.deepEqual([audit.log[0].details.from, audit.log[0].details.to], [1000, 1200]);
});

test('targets: ceo/admin only, per view, custom KPIs only in their own view', () => {
  const audit = fakeAudit();
  const targets = new Map();
  let writes = 0;
  const repo = {
    findTarget: (e, k) => (targets.has(`${e}|${k}`) ? { target: targets.get(`${e}|${k}`) } : null),
    upsertTarget: (e, k, v) => { writes += 1; targets.set(`${e}|${k}`, v); },
    findCustom: (e, id) => (e === 'ceas' && id === 7 ? { id: 7, key: 'custom_7', name: 'NPS' } : null),
    insertCustom: (f) => ({ id: 8, key: 'custom_8', ...f }),
    listTargets: () => [], listCustom: () => [], archiveCustom: () => {},
  };
  const svc = createTargetService({
    targetRepository: repo, transaction: (fn) => fn(), audit, knownKpiIds: ['dso'], componentIds: ['people'],
  });
  const set = (role, entity, kpiId, target) => status(() => svc.setTarget({ actor: actor(role), entity, kpiId, target }));
  assert.equal(set('operations', 'ceas', 'dso', 45), 403);
  assert.equal(set('ceo', 'ceas', 'dso', 45), 200);
  assert.equal(set('ceo', 'xx', 'dso', 45), 400);
  assert.equal(set('ceo', 'ceas', 'nope', 45), 404);
  assert.equal(set('ceo', 'ceas', 'custom_7', 10), 200);
  assert.equal(set('ceo', 'fze', 'custom_7', 10), 404);
  assert.equal(set('ceo', 'ceas', 'dso', 'abc'), 400);
  const before = writes;
  assert.equal(set('ceo', 'ceas', 'dso', 45), 200); // unchanged
  assert.equal(writes, before);
  const kpi = svc.addCustomKpi({ actor: actor('ceo'), entity: 'ceas', name: 'CSAT', unit: 'pct', direction: 'higher_better', targetType: 'min', component: 'people', actual: 80, target: 90 });
  assert.equal(kpi.target, 90);
  assert.equal(targets.get('ceas|custom_8'), 90);
});

test('escalation: ceo/admin only, known areas, boolean routing', () => {
  const audit = fakeAudit();
  const routes = { cash: 1 };
  const svc = createEscalationService({
    audit,
    escalationRepository: {
      findRoute: (a) => (a in routes ? { area: a, comesToCeo: routes[a] } : null),
      updateRoute: (a, v) => { routes[a] = v; },
      listRoutes: () => Object.entries(routes).map(([area, comesToCeo]) => ({ area, comesToCeo })),
      getThreshold: () => 150000,
      updateThreshold: () => {},
    },
  });
  assert.equal(status(() => svc.setRoute({ actor: actor('operations'), area: 'cash', comesToCeo: false })), 403);
  assert.equal(status(() => svc.setRoute({ actor: actor('ceo'), area: 'nope', comesToCeo: false })), 404);
  assert.equal(status(() => svc.setRoute({ actor: actor('ceo'), area: 'cash', comesToCeo: 'no' })), 400);
  assert.equal(svc.setRoute({ actor: actor('ceo'), area: 'cash', comesToCeo: false }).ceo.cash, 0);
  assert.equal(status(() => svc.setThreshold({ actor: actor('ceo'), amount: -1 })), 400);
});
