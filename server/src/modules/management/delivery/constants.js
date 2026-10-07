/* ClickUp's client-delivery space, "Ceas Comm | Kitchen" (verified
   2026-10-06: Content Calendars, Performance Marketing, Ceas Comm
   Projects (EXT) — 90% of its tasks carry the Client Name dropdown). */
const DELIVERY_SPACE_ID = '60099486';

const SYNC_INTERVAL_MINUTES = 15;
// Closed tasks kept for this long — the base for on-time delivery once its definition is agreed.
const CLOSED_WINDOW_DAYS = 90;
const MAX_PAGES = 60; // 100 tasks a page; well above today's ~1,500

/* Stages in the order work moves through them; each list has its own
   workflow, so names are matched lower-cased and trimmed, and any stage not
   listed sorts after these by size. */
const STAGE_ORDER = Object.freeze([
  'idea', 'briefing', 'briefing team', 'to do', 'open', 'in queue', 'ready to design', 'in progress', 'in progess',
  'internal review', 'internal approval', 'internal feedback', 'qc approval', 'qc feedback', 'account manager review',
  'visual feedback', 'content feedback', 'post feedback', 'working on feedback', 'client submission', 'client feedback',
  'client approval', 'approved', 'rtp', 'scheduled', 'ads are running', 'reporting', 'review', 'stuck', 'pause', 'rejected',
]);

module.exports = { DELIVERY_SPACE_ID, SYNC_INTERVAL_MINUTES, CLOSED_WINDOW_DAYS, MAX_PAGES, STAGE_ORDER };
