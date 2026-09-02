/* Fixed-value lists for employee profile fields that don't have a DB-level
   CHECK constraint (department, work_location — see migration 008's comment
   for why: adding one now would require a full SQLite table rebuild). This
   is the server-side source of truth those fields validate against; the
   frontend copy lives in server/public/shared/orgConstants.js and must be
   kept in sync by hand (same duplication the DB CHECK constraints for
   employment_type/status already accept — see roster.js's own inline
   arrays). */
const DEPARTMENTS = Object.freeze([
  'account_managers',
  'content',
  'designers',
  'operations',
  'public_relations',
  'performance',
  'production',
  'sales_business_development',
  'social_media_specialists',
]);

const DEPARTMENT_LABELS = Object.freeze({
  account_managers: 'Account Managers',
  content: 'Content',
  designers: 'Designers',
  operations: 'Operations',
  public_relations: 'Public Relations',
  performance: 'Performance',
  production: 'Production',
  sales_business_development: 'Sales & Business Development',
  social_media_specialists: 'Social Media Specialists',
});

const WORK_LOCATIONS = Object.freeze(['remote', 'cairo_office', 'alex_office', 'hybrid_cairo', 'hybrid_alex']);

const WORK_LOCATION_LABELS = Object.freeze({
  remote: 'Remote',
  cairo_office: 'Cairo Office',
  alex_office: 'Alex Office',
  hybrid_cairo: 'Hybrid (Cairo)',
  hybrid_alex: 'Hybrid (Alex)',
});

module.exports = { DEPARTMENTS, DEPARTMENT_LABELS, WORK_LOCATIONS, WORK_LOCATION_LABELS };
