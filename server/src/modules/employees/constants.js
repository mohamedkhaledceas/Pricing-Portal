/* Fixed-value list for work_location, which doesn't have a DB-level CHECK
   constraint (see migration 008's comment for why: adding one now would
   require a full SQLite table rebuild). This is the server-side source of
   truth it validates against; the frontend copy lives in
   server/public/shared/orgConstants.js and must be kept in sync by hand.

   department used to live here too as an identical frozen array — it's now
   a real departmentRepository-backed table instead (see docs/adr/0011),
   since a hardcoded list meant adding a department required a code change
   and a deploy. */
const WORK_LOCATIONS = Object.freeze(['remote', 'cairo_office', 'alex_office']);

const WORK_LOCATION_LABELS = Object.freeze({
  remote: 'Remote',
  cairo_office: 'Cairo',
  alex_office: 'Alex',
});

/* Job title, same fixed-list treatment as work_location above. Enforced on
   the signup wizard's self-registration path, the admin roster table, and
   the self-service work-details change-request flow. Already
   human-readable, so unlike WORK_LOCATIONS there's no separate code/label
   split — the string is both the stored value and the display text. */
const JOB_TITLES = Object.freeze([
  'Graphic Designer', 'Account Manager', 'Account Executive', 'Art Director', 'Operation Manager',
  'Traffic Manager', 'Project Manager', 'Media Buyer', 'Video Editor', 'Content Creator',
  'People & Culture', 'Social Media Executive', 'Reel Creator', 'Photographer/Videographer',
  'Head of Production', 'Head of Content Creation', 'Creative Director', 'Business Developer',
  'Freelancer', 'Sales', 'UGC', 'Motion Graphic', 'Marketing Manager', 'Executive Assistant',
  'Developers', 'Software Engineer',
]);

module.exports = { WORK_LOCATIONS, WORK_LOCATION_LABELS, JOB_TITLES };
