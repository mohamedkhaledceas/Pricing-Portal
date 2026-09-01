/* Plain ADD COLUMN, no table rebuild needed — none of these touch an
   existing column's CHECK, and SQLite allows a CHECK constraint on a
   newly-added column as long as it only references that column.

   `status` deliberately excludes 'on_leave' from its CHECK: on_leave is
   never written to this column, only computed at read time from approved
   leave_requests covering today (see rosterService), so it can't drift
   from the real leave state the way a manually-set third option could. */
function up(db) {
  db.exec(`
    ALTER TABLE employees ADD COLUMN job_title TEXT;
    ALTER TABLE employees ADD COLUMN employment_type TEXT CHECK (employment_type IN ('full_time','part_time','freelancer'));
    ALTER TABLE employees ADD COLUMN joining_date TEXT;
    ALTER TABLE employees ADD COLUMN work_location TEXT;
    ALTER TABLE employees ADD COLUMN working_hours TEXT;
    ALTER TABLE employees ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','remote'));
    ALTER TABLE employees ADD COLUMN photo_url TEXT;
  `);
}

module.exports = { up };
