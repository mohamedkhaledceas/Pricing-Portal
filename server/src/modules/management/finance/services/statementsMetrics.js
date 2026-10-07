/* Odoo statements for the Control Room: the Profit and Loss (one company,
   or all companies in Odoo's year-average conversion), the balance sheet
   and cash, and each company's year history. Rebuilt from the copied
   journal items exactly as Odoo's own reports define them (verified to the
   piastre 2026-10-06; dataCheckService guards it). Composed into
   financeMetricsService, finance's public read interface. */
const { ENTITIES, CONSOLIDATION_CURRENCY } = require('../constants');
const { periodAverageRate, toPnlLines } = require('./reportMath');
const { MONTH_LABELS, addDays, round } = require('./metricsShared');

function createStatementsMetrics({
  pnlRepository, balanceRepository, invoiceRepository, cashAccountTypes, entityOrThrow, today,
}) {
  /* The Revenue line of Odoo's Profit and Loss for all companies, for the
     whole calendar year (Odoo's "2026" filter): −(income balance) per
     company in its own currency, then other currencies converted the way
     Odoo's report does (periodAverageRate). Differs from the invoiced
     figure twice over: a different conversion, and income posted outside
     invoices counts here. */
  function getConsolidatedPnlRevenue(year) {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const byCompany = new Map();
    for (const row of pnlRepository.sumByCompanyAndType(from, to)) {
      if (row.accountType === 'income') byCompany.set(row.companyId, -row.balance);
    }
    const rateCache = new Map();
    let total = 0;
    const rates = {};
    for (const entity of Object.values(ENTITIES)) {
      const own = byCompany.get(entity.companyId) || 0;
      if (entity.currency === CONSOLIDATION_CURRENCY) { total += own; continue; }
      if (!rateCache.has(entity.currency)) {
        rateCache.set(entity.currency, periodAverageRate(pnlRepository.listRates(entity.currency), from, to));
      }
      rates[entity.currency] = rateCache.get(entity.currency);
      total += own * rates[entity.currency];
    }
    return { year, revenue: round(total), rates };
  }

  /* Odoo's Profit and Loss, the way Accounting → Reporting → Profit and
     Loss shows it for the calendar year (everything posted to date).
     One company: its own currency, with the same period last year (1 Jan
     to the same day) beside it. All: each company converted the way
     Odoo's multi-company report does (periodAverageRate over the year);
     no prior year, because Odoo holds no AED rate before 2026-02-01 and
     would count every 2025 AED as 1 EGP. Months under All use the year's
     rate, so they add up to the year. */
  function getProfitAndLoss(entityKey) {
    const consolidated = entityKey === 'all';
    const asOf = today();
    const year = Number(asOf.slice(0, 4));
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const companies = consolidated
      ? Object.values(ENTITIES)
      : [entityOrThrow(entityKey)];
    const rates = {};
    const factor = new Map();
    for (const e of companies) {
      if (!consolidated || e.currency === CONSOLIDATION_CURRENCY) { factor.set(e.companyId, 1); continue; }
      if (rates[e.currency] == null) rates[e.currency] = periodAverageRate(pnlRepository.listRates(e.currency), from, to);
      factor.set(e.companyId, rates[e.currency]);
    }
    const collect = (rows) => {
      const b = {};
      for (const row of rows) {
        const f = factor.get(row.companyId);
        if (f == null) continue;
        b[row.accountType] = (b[row.accountType] || 0) + row.balance * f;
      }
      return b;
    };

    const current = toPnlLines(collect(pnlRepository.sumByCompanyAndType(from, to)));
    const priorTo = `${year - 1}${asOf.slice(4)}`;
    const prior = consolidated ? null : toPnlLines(collect(pnlRepository.sumByCompanyAndType(`${year - 1}-01-01`, priorTo)));

    const monthly = new Map();
    for (const row of pnlRepository.sumByCompanyTypeAndMonth(from, asOf)) {
      const f = factor.get(row.companyId);
      if (f == null) continue;
      const m = monthly.get(row.month) || {};
      m[row.accountType] = (m[row.accountType] || 0) + row.balance * f;
      monthly.set(row.month, m);
    }
    const monthIndex = Number(asOf.slice(5, 7)) - 1;
    const months = MONTH_LABELS.slice(0, monthIndex + 1).map((label, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      return { month: label, ...toPnlLines(monthly.get(key) || {}) };
    });

    return {
      asOf,
      year,
      priorTo,
      currency: consolidated ? CONSOLIDATION_CURRENCY : companies[0].currency,
      consolidated,
      rates,
      current,
      prior,
      months,
    };
  }

  /* One company's balance sheet as at today, line for line as Odoo's
     Accounting → Reporting → Balance Sheet (account.report 4) builds it,
     plus the Accounting dashboard's Cash block for this year. Per company
     only: how Odoo converts a multi-company balance sheet hasn't been
     verified, and the portal never picks a rate.

     Signs follow the report: assets are debit balances, liabilities and
     equity credit balances shown positive. Equity's unallocated earnings
     are every P&L line since the books began (current year shown apart),
     so the sheet balances by construction of double entry — `balances`
     reports whether it does, as a check on the data. */
  function getBalanceSheet(entityKey) {
    const { companyId, currency } = entityOrThrow(entityKey);
    const asOf = today();
    const year = asOf.slice(0, 4);
    const fyStart = `${year}-01-01`;
    const BEGIN = '0000-01-01';

    const bs = {};
    for (const r of balanceRepository.sumByType(companyId, BEGIN, asOf)) {
      const key = r.nonTrade ? `${r.accountType}:non_trade` : r.accountType;
      bs[key] = (bs[key] || 0) + r.balance;
    }
    const b = (key) => bs[key] || 0;
    const pnlAll = Object.fromEntries(pnlRepository.sumByTypeForCompany(companyId, BEGIN, asOf).map((r) => [r.accountType, r.balance]));
    const pnlYear = Object.fromEntries(pnlRepository.sumByTypeForCompany(companyId, fyStart, asOf).map((r) => [r.accountType, r.balance]));
    const equityYear = balanceRepository.sumByType(companyId, fyStart, asOf)
      .filter((r) => r.accountType === 'equity').reduce((s, r) => s + r.balance, 0);
    const pnlTypes = ['income', 'income_other', 'expense_direct_cost', 'expense', 'expense_depreciation', 'expense_other'];
    const sumTypes = (o, types) => types.reduce((s, t) => s + (o[t] || 0), 0);

    const bank = b('asset_cash');
    const receivables = b('asset_receivable');
    const otherCurrentAssets = b('asset_current') + b('asset_receivable:non_trade');
    const prepayments = b('asset_prepayments');
    const currentAssets = bank + receivables + otherCurrentAssets + prepayments;
    const fixedAssets = b('asset_fixed');
    const nonCurrentAssets = b('asset_non_current');
    const assets = currentAssets + fixedAssets + nonCurrentAssets;

    const currentLiabilities = -(b('liability_current') + b('liability_credit_card') + b('liability_payable:non_trade'));
    const payables = -b('liability_payable');
    const nonCurrentLiabilities = -b('liability_non_current');
    const liabilities = currentLiabilities + payables + nonCurrentLiabilities;

    // CURR_YEAR_EARNINGS = net profit this year − allocations this year.
    const currentYearEarnings = -sumTypes(pnlYear, pnlTypes) - (pnlYear.equity_unaffected || 0);
    const allEarnings = -sumTypes(pnlAll, pnlTypes) - (pnlAll.equity_unaffected || 0);
    const previousYearsEarnings = allEarnings - currentYearEarnings;
    const currentRetained = -equityYear;
    const retained = -(b('equity') + b('equity:non_trade'));
    const previousRetained = retained - currentRetained;
    const equity = allEarnings + retained;

    const r = (n) => Math.round(n);
    const cashFlows = balanceRepository.sumCashFlows(companyId, cashAccountTypes, fyStart, asOf);
    const accounts = balanceRepository.listCashAccounts(companyId, cashAccountTypes, asOf)
      .filter((a) => Math.round(a.balance * 100) !== 0)
      .map((a) => ({ code: a.code, name: a.name, type: a.accountType, balance: r(a.balance) }));
    const closing = accounts.reduce((s, a) => s + a.balance, 0);

    // Cash runway: closing balance ÷ average monthly cash spent over the
    // last three full months. The portal's own definition — Odoo has none.
    const [y, m] = asOf.split('-').map(Number);
    const threeMonthsBack = new Date(Date.UTC(y, m - 4, 1)).toISOString().slice(0, 10);
    const lastMonthEnd = addDays(`${asOf.slice(0, 7)}-01`, -1);
    const spent3 = balanceRepository.sumCashFlowsByMonth(companyId, cashAccountTypes, threeMonthsBack, lastMonthEnd)
      .reduce((s, mo) => s + mo.spent, 0);
    const avgSpent = spent3 / 3;

    return {
      asOf,
      currency,
      balanceSheet: {
        bank: r(bank), receivables: r(receivables), otherCurrentAssets: r(otherCurrentAssets), prepayments: r(prepayments),
        currentAssets: r(currentAssets), fixedAssets: r(fixedAssets), nonCurrentAssets: r(nonCurrentAssets), assets: r(assets),
        currentLiabilities: r(currentLiabilities), payables: r(payables), nonCurrentLiabilities: r(nonCurrentLiabilities),
        liabilities: r(liabilities),
        currentYearEarnings: r(currentYearEarnings), previousYearsEarnings: r(previousYearsEarnings),
        currentRetained: r(currentRetained), previousRetained: r(previousRetained), equity: r(equity),
        liabilitiesAndEquity: r(liabilities + equity),
        balances: Math.abs(assets - (liabilities + equity)) < 1,
      },
      cash: {
        received: r(cashFlows.received),
        spent: r(cashFlows.spent),
        surplus: r(cashFlows.received - cashFlows.spent),
        opening: r(closing - (cashFlows.received - cashFlows.spent)),
        closing,
        accounts,
        averageMonthlySpent: r(avgSpent),
        runwayMonths: avgSpent > 0 ? Math.round((closing / avgSpent) * 10) / 10 : null,
      },
    };
  }

  /* One company's years from Odoo, for the Control Room's year review and
     year-on-year comparison (phase 6). Each year since its books began:
     - ytd: 1 January to today's date in that year — revenue (invoiced, the
       Control Room's revenue), cost of revenue, gross margin, operating
       expenses and ratio, net profit and margin (Profit and Loss lines);
     - at: on that same date — cash (every bank/cash/credit-card account),
       runway (cash ÷ average monthly cash spent over the three months
       before), receivables (trade) and DSO (receivables ÷ the 90 days'
       billing before, VAT incl., × 90);
     - full: closed years only — the same over the whole year, cash at
       31 December.
     Delivery, people and pipeline history aren't in Odoo, so those stay
     null. Per company: Odoo holds no AED rate before 2026-02-01, so an
     all-companies history would count 2025's AED as EGP. */
  function getYearHistory(entityKey) {
    const { companyId, currency } = entityOrThrow(entityKey);
    const asOf = today();
    const thisYear = Number(asOf.slice(0, 4));
    // 29 February has no twin in most years; compare on the 28th then.
    const mmdd = asOf.slice(5) === '02-29' ? '02-28' : asOf.slice(5);
    const first = pnlRepository.firstDate(companyId);
    const firstYear = first ? Number(first.slice(0, 4)) : thisYear;
    const r = (n) => (n == null ? null : Math.round(n));
    const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

    const periodFigures = (from, to) => {
      const t = Object.fromEntries(pnlRepository.sumByTypeForCompany(companyId, from, to).map((x) => [x.accountType, x.balance]));
      const p = toPnlLines(t);
      const invoiced = invoiceRepository.sumUntaxedByMonth(companyId, from, to).reduce((s, m) => s + m.total, 0);
      return {
        revenue: r(invoiced),
        directCost: p.costOfRevenue,
        grossMargin: pct(p.grossProfit, p.revenue),
        opex: p.operatingExpenses,
        opexRatio: pct(p.operatingExpenses, p.revenue),
        netProfit: p.netProfit,
        netMargin: pct(p.netProfit, p.revenue),
      };
    };
    const cashAt = (date) => balanceRepository.listCashAccounts(companyId, cashAccountTypes, date).reduce((s, a) => s + a.balance, 0);
    const positionAt = (date) => {
      const cash = cashAt(date);
      const [y, m] = date.split('-').map(Number);
      const spent3 = balanceRepository.sumCashFlowsByMonth(companyId, cashAccountTypes,
        new Date(Date.UTC(y, m - 4, 1)).toISOString().slice(0, 10), addDays(`${date.slice(0, 7)}-01`, -1))
        .reduce((s, mo) => s + mo.spent, 0);
      const receivables = balanceRepository.sumByType(companyId, '0000-01-01', date)
        .filter((x) => x.accountType === 'asset_receivable' && !x.nonTrade).reduce((s, x) => s + x.balance, 0);
      const billed90 = invoiceRepository.sumTotalSigned(companyId, addDays(date, -89), date);
      // Not meaningful → null: a runway on no or negative cash, or a DSO over
      // a year (almost nothing billed in the window, e.g. FZE's first months).
      const dso = billed90 > 0 ? Math.round((receivables / billed90) * 90) : null;
      return {
        cash: r(cash),
        runway: spent3 > 0 && cash > 0 ? Math.round((cash / (spent3 / 3)) * 10) / 10 : null,
        receivables: r(receivables),
        dso: dso != null && dso <= 365 ? dso : null,
      };
    };

    const years = {};
    for (let y = firstYear; y <= thisYear; y += 1) {
      const through = `${y}-${mmdd}`;
      // Books that only began after this year's comparison date leave nothing to compare.
      if (first && first > through) continue;
      const closed = y < thisYear;
      years[String(y)] = {
        label: String(y),
        status: closed ? 'closed' : 'current',
        through,
        // A year the books started part-way through: its figures are from that date.
        partialFrom: first && first > `${y}-01-01` && first.startsWith(String(y)) ? first : null,
        ytd: periodFigures(`${y}-01-01`, through),
        at: positionAt(through),
        full: closed ? { ...periodFigures(`${y}-01-01`, `${y}-12-31`), cash: r(cashAt(`${y}-12-31`)) } : null,
      };
    }
    return { asOf, currency, currentYear: String(thisYear), booksStart: first, years };
  }

  return { getConsolidatedPnlRevenue, getProfitAndLoss, getBalanceSheet, getYearHistory };
}

module.exports = createStatementsMetrics;
