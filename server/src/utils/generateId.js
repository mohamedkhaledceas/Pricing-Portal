/* Genuinely cross-module (modules/pricing's team/expense/project/line/
   direct-cost/scenario/quote-line create paths all need the same scheme) —
   see docs/adr/0002 for why utils/ is reserved for exactly this case.
   Same `${prefix}-${timestamp}-${random}` shape the legacy Planner routes
   already used — kept as-is since these are plain row keys, not security
   tokens, and nothing depends on the format changing. */
function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = generateId;
