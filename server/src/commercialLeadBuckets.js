/* Single source of truth for status -> funnel-bucket classification — the
   live sync hook, the historical backfill script, the quarter-close freeze
   job, and every read query all call mapStatusToBucket() from here rather
   than each carrying their own copy of this table. See
   docs/adr/0010-commercial-lead-quarterly-kpis.md for why each bucket is
   defined the way it is; 'complete' (distinct from 'contract completed')
   is intentionally absent — excluded from the funnel pending clarification
   of its operational meaning. */
const STATUS_TO_BUCKET = {
  'leads': 'leads',
  'qualified': 'qualified',
  // Trailing space is real, not a typo here — ClickUp's actual status value
  // for this one is "in queue " (confirmed via commercial_lead_status_colors
  // and live deal data, not assumed); the pre-existing commercialLead.js
  // code already had to .trim() it for display for the same reason. Without
  // this exact match, every "in queue " deal silently maps to no bucket at
  // all, dropped from the funnel entirely rather than counted as qualified.
  'in queue ': 'qualified',
  'onboarding': 'onboarding',
  'in progress': 'in_progress',
  'contract completed': 'won',
  'stuck': 'lost',
  'lost': 'lost',
  'unqulified': 'lost', // matches ClickUp's actual (misspelled) status value
  'terminated by agency': 'lost',
  'terminated by client': 'lost',
  'no answer': 'lost',
};

function mapStatusToBucket(status) {
  return STATUS_TO_BUCKET[status] || null;
}

/* The strictly-ordered part of the funnel, per the confirmed business flow:
   leads -> qualified (on first call) -> onboarding (work starts) ->
   in_progress (onboarding finished) -> won. 'lost' is deliberately excluded
   from this ordering — a deal can go lost from any of those stages, so
   there is no single implied sequence for it (see bucketsToBackfill). */
const FUNNEL_ORDER = ['leads', 'qualified', 'onboarding', 'in_progress', 'won'];

/* For the one-time historical backfill only (see
   docs/commercial-lead-quarterly-kpis-plan.md §4): live-captured data
   (clickupSync.js) logs a bucket_events row for every stage a deal
   actually passes through in real time, so "has an event for bucket X"
   already means "reached X at some point" for anything tracked going
   forward. Backfilled data has only one known data point per deal — its
   CURRENT status — so recording only that single bucket would silently
   undercount every earlier stage for any deal that has since moved on
   (e.g. a deal now 'won' would show zero for qualified/onboarding/
   in_progress, even though it necessarily passed through all of them).
   Since the funnel order above is a strict, confirmed sequence, a deal
   currently at bucket X is known to have passed through every bucket
   before X too — so backfill seeds one row per preceding stage as well,
   all dated at the deal's creation date (still an approximation of WHEN,
   openly marked is_backfilled, but no longer an undercount of WHICH
   stages were reached). 'lost' has no implied preceding path — a lost
   deal could have dropped off from leads, qualified, onboarding, or
   in_progress, and backfill has no way to know which, so only 'lost'
   itself is recorded, honestly leaving that ambiguity unresolved rather
   than guessing. */
function bucketsToBackfill(currentBucket) {
  if (currentBucket === 'lost') return ['lost'];
  const idx = FUNNEL_ORDER.indexOf(currentBucket);
  if (idx === -1) return []; // unmapped (e.g. null from 'complete') — nothing to backfill
  return FUNNEL_ORDER.slice(0, idx + 1);
}

module.exports = { STATUS_TO_BUCKET, mapStatusToBucket, FUNNEL_ORDER, bucketsToBackfill };
