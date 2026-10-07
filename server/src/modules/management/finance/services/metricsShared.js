/* Small date and number helpers shared by finance's metrics services.
   Dates are Africa/Cairo calendar dates as YYYY-MM-DD strings. */
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function cairoToday() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

const DAY_MS = 24 * 60 * 60 * 1000;
const toUtc = (date) => Date.parse(`${date}T00:00:00Z`);
const addDays = (date, days) => new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
const round = (value) => Math.round(value);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

module.exports = { MONTH_LABELS, cairoToday, addDays, daysBetween, round, pct };
