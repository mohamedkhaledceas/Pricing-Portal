/* The Odoo calculations the Control Room's money figures rest on. Run with
   `npm test` (Node's built-in runner — no dependencies). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { periodAverageRate, toPnlLines, invoicesOpen } = require('../src/modules/management/finance/services/reportMath');
// Odoo's AED rates as Ceas Comm recorded them up to 2026-10-05 (public FX rates).
const AED_2026 = require('./fixtures/aedRates2026.json');

test('P&L lines follow Odoo\'s report: income negative, allocations after net profit', () => {
  const p = toPnlLines({
    income: -100, expense_direct_cost: 30, expense: 50, income_other: -5, expense_depreciation: 1, expense_other: 1,
    equity_unaffected: 10,
  });
  assert.deepEqual(p, {
    revenue: 100, costOfRevenue: 30, grossProfit: 70, operatingExpenses: 50, operatingIncome: 20, otherIncome: 5,
    otherExpenses: 2, netProfit: 23, allocations: 10, netProfitAfterAllocations: 13,
  });
});

test('P&L lines treat missing account types as zero', () => {
  assert.equal(toPnlLines({}).netProfit, 0);
});

test('year-average rate reproduces Odoo\'s 2026 multi-company P&L (12.794048, verified 2026-10-06)', () => {
  assert.equal(periodAverageRate(AED_2026, '2026-01-01', '2026-12-31').toFixed(6), '12.794048');
});

test('year-average rate counts days before the first rate as 1, as Odoo does', () => {
  const rates = [{ date: '2026-01-03', inverseRate: 10 }];
  // 2 days at 1, 2 days at 10.
  assert.equal(periodAverageRate(rates, '2026-01-01', '2026-01-04'), 5.5);
});

test('year-average rate carries the latest rate forward', () => {
  const rates = [{ date: '2026-01-01', inverseRate: 2 }, { date: '2026-01-03', inverseRate: 4 }];
  assert.equal(periodAverageRate(rates, '2026-01-01', '2026-01-04'), 3);
});

test('open bills: overdue means due before today', () => {
  const r = invoicesOpen([
    { residual: 100, dueDate: '2026-10-01' }, { residual: 50, dueDate: '2026-10-06' }, { residual: 10, dueDate: null },
  ], '2026-10-06');
  assert.deepEqual({ total: r.total, overdue: r.overdue, overdueCount: r.overdueCount }, { total: 160, overdue: 100, overdueCount: 1 });
});
