/* Tracks whether P&C confirmed a doctor's note was provided for a sick-leave
   request that already requires one (over 2 consecutive working days, per
   timeOffRules.sickLeaveRequiresDoctorNote) — set at P&C confirmation time,
   alongside salary_deduction/unpaid_days_count. Drives leaveBalanceRules:
   no note means the request is deducted from the same 7-day combined pool
   Emergency/Mental Health/Short-Notice already share, instead of staying
   uncapped. Plain ADD COLUMN, same reasoning as 003/009 — no CHECK
   constraint, no rebuild needed. Defaults to 0 (not provided) so a request
   that predates this column, or one P&C hasn't touched yet, reads as
   "no note" rather than an ambiguous NULL. */
function up(db) {
  db.exec(`ALTER TABLE leave_requests ADD COLUMN doctor_note_provided INTEGER NOT NULL DEFAULT 0;`);
}

module.exports = { up };
