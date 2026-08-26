const db = require('./db');

/* Server-side port of margin-planner_1.html's own company()/personCalc()/
   expMonthly()/toBase() math (search that file for the same function names
   to compare line-for-line). That calculation exists ONLY client-side today
   — confirmed by grepping index.js and db.js for payroll/burn/ohPerHour/
   billableHours before writing this file, per the "don't duplicate, reuse
   if it already exists" instruction this was written under. This is the
   one and only server-side copy; anything that needs the company-wide cost
   rollup (currently just the CEO Dashboard, see
   modules/management/ceo-dashboard/repositories/mockSnapshotRepository.js)
   should call getCompanyCostSummary() rather than re-deriving it. */

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function rateOf(settings, cur) {
  if (cur === settings.currency) return 1;
  const r = num((settings.rates || {})[cur]);
  return r > 0 ? r : 1;
}

function toBase(settings, v, cur) {
  return num(v) * rateOf(settings, cur || settings.currency);
}

function personCalc(settings, person) {
  const monthlyCost = toBase(settings, person.salary, person.cur) + toBase(settings, person.extras, person.cur);
  const hours = num(person.hours) || 0;
  const billable = hours * (num(person.util) / 100);
  const raw = hours > 0 ? monthlyCost / hours : 0;
  const recovery = billable > 0 ? monthlyCost / billable : 0;
  const auto = settings.basis === 'raw' ? raw : recovery;
  const rate = (person.override !== null && person.override !== '' && Number.isFinite(parseFloat(person.override)))
    ? toBase(settings, person.override, person.cur)
    : auto;
  return { monthlyCost, hours, billable, raw, recovery, rate };
}

function expMonthly(settings, expense) {
  const a = toBase(settings, expense.amount, expense.cur);
  if (expense.freq === 'year') return a / 12;
  if (expense.freq === 'quarter') return a / 3;
  if (expense.freq === 'week') return (a * 52) / 12;
  if (expense.freq === 'once') return 0;
  return a;
}

/* Returns the same shape mockSnapshotRepository.js's `costs` block already
   uses: { burn, payroll, fixed, headcount, billableHours, ohPerHour,
   categories }. `categories` groups real (free-text) expense `cat` values
   by their monthly-equivalent amount, descending — the mock's illustrative
   4-category list is replaced by whatever's actually been entered in the
   Planner's Fixed expenses tab. */
function getCompanyCostSummary() {
  const settings = db.readCompanySettings();
  const team = db.readTeam();
  const expenses = db.readExpenses();

  let payroll = 0;
  let billableHours = 0;
  team.forEach((person) => {
    const calc = personCalc(settings, person);
    payroll += calc.monthlyCost;
    billableHours += calc.billable;
  });

  const categoryTotals = new Map();
  let fixed = 0;
  expenses.forEach((expense) => {
    const monthly = expMonthly(settings, expense);
    fixed += monthly;
    const label = expense.cat || 'Uncategorized';
    categoryTotals.set(label, (categoryTotals.get(label) || 0) + monthly);
  });
  const categories = Array.from(categoryTotals, ([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  const burn = payroll + fixed;
  const ohPerHour = billableHours > 0 ? fixed / billableHours : 0;

  return {
    burn,
    payroll,
    fixed,
    headcount: team.length,
    billableHours,
    ohPerHour,
    categories,
  };
}

module.exports = { getCompanyCostSummary };
