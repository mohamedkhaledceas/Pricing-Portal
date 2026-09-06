/* Fixed-value list for work_location, which doesn't have a DB-level CHECK
   constraint (see migration 008's comment for why: adding one now would
   require a full SQLite table rebuild). This is the server-side source of
   truth it validates against; the frontend copy lives in
   server/public/shared/orgConstants.js and must be kept in sync by hand.

   department used to live here too as an identical frozen array — it's now
   a real departmentRepository-backed table instead (see docs/adr/0011),
   since a hardcoded list meant adding a department required a code change
   and a deploy. */
const WORK_LOCATIONS = Object.freeze(['remote', 'cairo_office', 'alex_office', 'hybrid_cairo', 'hybrid_alex']);

const WORK_LOCATION_LABELS = Object.freeze({
  remote: 'Remote',
  cairo_office: 'Cairo Office',
  alex_office: 'Alex Office',
  hybrid_cairo: 'Hybrid (Cairo)',
  hybrid_alex: 'Hybrid (Alex)',
});

module.exports = { WORK_LOCATIONS, WORK_LOCATION_LABELS };
