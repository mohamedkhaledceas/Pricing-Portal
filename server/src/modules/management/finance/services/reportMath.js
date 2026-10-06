/* The pure calculations behind the Control Room's Odoo figures, kept apart
   so they can be tested (test/reportMath.test.js) without a database:
   Odoo's Profit and Loss lines from account-type balances, the year-average
   rate Odoo's multi-company report converts with, and open-bill totals.
   No I/O here. */
const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/* Odoo's multi-company Profit and Loss converts each company's figures at
   the average of Odoo's daily rate over the report period: every day
   counts once, a day takes the latest rate dated on or before it (so
   future days carry today's), and days before the first stored rate count
   as 1 — Odoo has no AED rate before 2026-02-01, so January counts AED as
   EGP. Reproduced to the piastre against Odoo's own report on 2026-10-06
   (12.794048 for 2026); never a rate the portal chose. */
function periodAverageRate(rates, fromDate, toDate) {
  let sum = 0;
  let days = 0;
  let idx = -1;
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    while (idx + 1 < rates.length && rates[idx + 1].date <= d) idx += 1;
    sum += idx >= 0 ? rates[idx].inverseRate : 1;
    days += 1;
  }
  return days ? sum / days : 1;
}

/* Odoo's Profit and Loss lines (account.report 7) from account-type
   balances (debit − credit, so income is negative). */
function toPnlLines(b) {
  const v = (type) => b[type] || 0;
  const revenue = -v('income');
  const costOfRevenue = v('expense_direct_cost');
  const operatingExpenses = v('expense');
  const otherIncome = -v('income_other');
  const otherExpenses = v('expense_depreciation') + v('expense_other');
  const allocations = v('equity_unaffected');
  const grossProfit = revenue - costOfRevenue;
  const operatingIncome = grossProfit - operatingExpenses;
  const netProfit = operatingIncome + otherIncome - otherExpenses;
  const r = (n) => Math.round(n) + 0; // + 0 turns -0 (e.g. −income of nothing) into 0
  return {
    revenue: r(revenue),
    costOfRevenue: r(costOfRevenue),
    grossProfit: r(grossProfit),
    operatingExpenses: r(operatingExpenses),
    operatingIncome: r(operatingIncome),
    otherIncome: r(otherIncome),
    otherExpenses: r(otherExpenses),
    netProfit: r(netProfit),
    allocations: r(allocations),
    netProfitAfterAllocations: r(netProfit - allocations),
  };
}

// Open bills with their overdue share (due before today).
function invoicesOpen(rows, asOf) {
  let total = 0;
  let overdue = 0;
  let overdueCount = 0;
  for (const b of rows) {
    total += b.residual;
    if (b.dueDate && b.dueDate < asOf) { overdue += b.residual; overdueCount += 1; }
  }
  return { rows, total, overdue, overdueCount };
}

module.exports = { periodAverageRate, toPnlLines, invoicesOpen };
