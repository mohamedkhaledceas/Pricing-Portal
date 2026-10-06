/* Every ClickUp sync shares one rate limit (100 requests a minute per
   token). Each schedule gets its own minute offset so they don't all fire
   at :00 / :15 / :30 / :45 together:

     commercial-leads reconcile  :03 (+30)    employees user sync  :18 (+30)
     KPI list sync               :25 (hourly) clients              :11 (+30)
     delivery                    :07 (+15)    Odoo (separate API)  :00 (+15)

   staggeredMinutes(30, 11) → "11-59/30" (minutes 11 and 41). An offset at
   or beyond the interval wraps. */
function staggeredMinutes(interval, offset) {
  const every = Math.max(1, Math.min(60, Number(interval) || 60));
  return `${offset % every}-59/${every}`;
}

module.exports = { staggeredMinutes };
