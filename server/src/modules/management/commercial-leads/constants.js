/* Single source for the tracked ClickUp list IDs — previously defined
   separately (but identically) in commercialLead.js, clickupSync.js, and
   commercialLeadBackfill.js. Consolidated here since they're bit-for-bit
   the same values with no functional difference; keeping three copies in
   sync by hand was pure drift risk, not a deliberate separation.

   Friendly keys for the frontend — real ClickUp list IDs stay an
   implementation detail on this side. */
const LISTS = {
  pipeline: '901518274897', // 2026 Projects — the only one with computed insights
  activeClients: '901522751511', // Active Clients — AM — live display only
  offboarding: '901524651435', // Client Offboarding list — synced, no dedicated UI yet
};

// All 3 lists (all inside the "2026 - Ceas Comm" folder the webhook is
// scoped to) are synced. Of those, only INSIGHTS_LIST_ID gets computed
// insights (stage tracking/history, daily counts, quarterly KPIs) — the
// other two are live-display-only, per the discovery finding that neither
// is actually a funnel-shaped pipeline.
const TRACKED_LISTS = new Set(Object.values(LISTS));
const INSIGHTS_LIST_ID = LISTS.pipeline;

module.exports = { LISTS, TRACKED_LISTS, INSIGHTS_LIST_ID };
