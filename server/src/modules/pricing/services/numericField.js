const { PricingError } = require('../errors');

/* Same validation primitive the legacy Planner routes' numOrDefault() used —
   shared across this module's services (settings/team/expense/project all
   need it), not promoted to top-level utils/ since nothing outside pricing
   uses it. */
function numOrDefault(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) throw new PricingError(`${fieldName} must be a number.`);
  return num;
}

module.exports = { numOrDefault };
