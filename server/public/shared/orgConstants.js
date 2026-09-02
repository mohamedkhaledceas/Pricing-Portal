/* Shared fixed-value lists for employee profile fields — used by the roster
   table, the signup wizard, Account Settings' Work Details section, and the
   Teams directory. Classic script (window.OrgConstants), same loading
   convention as accountMenu.js, so it works identically whether the loading
   page uses ES modules (roster.js) or plain classic scripts
   (accountSettings.js, the login page).

   Mirrors server/src/modules/employees/constants.js — kept in sync by hand;
   the actual enforcement lives server-side (rosterService), this is display/
   dropdown-population only. */
(function () {
  const DEPARTMENTS = [
    'account_managers',
    'content',
    'designers',
    'operations',
    'public_relations',
    'performance',
    'production',
    'sales_business_development',
    'social_media_specialists',
  ];

  const DEPARTMENT_LABELS = {
    account_managers: 'Account Managers',
    content: 'Content',
    designers: 'Designers',
    operations: 'Operations',
    public_relations: 'Public Relations',
    performance: 'Performance',
    production: 'Production',
    sales_business_development: 'Sales & Business Development',
    social_media_specialists: 'Social Media Specialists',
  };

  const WORK_LOCATIONS = ['remote', 'cairo_office', 'alex_office', 'hybrid_cairo', 'hybrid_alex'];

  const WORK_LOCATION_LABELS = {
    remote: 'Remote',
    cairo_office: 'Cairo Office',
    alex_office: 'Alex Office',
    hybrid_cairo: 'Hybrid (Cairo)',
    hybrid_alex: 'Hybrid (Alex)',
  };

  const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'freelancer'];

  const EMPLOYMENT_TYPE_LABELS = {
    full_time: 'Full-time',
    part_time: 'Part-time',
    freelancer: 'Freelancer',
  };

  window.OrgConstants = {
    DEPARTMENTS,
    DEPARTMENT_LABELS,
    WORK_LOCATIONS,
    WORK_LOCATION_LABELS,
    EMPLOYMENT_TYPES,
    EMPLOYMENT_TYPE_LABELS,
  };
})();
