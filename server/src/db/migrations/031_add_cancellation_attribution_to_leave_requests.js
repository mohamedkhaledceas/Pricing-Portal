/* Backs the manager/P&C cancel-override flow: a requester can only cancel
   their own request while it's pending/manager_approved/auto_rejected (see
   timeOffService.cancel); once it's approved, or manually rejected, only
   the request's own manager or People & Culture can move it to cancelled
   (timeOffService.managerHrCancel). cancel_actor_role is what lets the
   timeline/confirm-rejection flow tell "the requester cancelled this
   themselves" (still awaiting manager/P&C confirmation, or reversal to
   rejected+deduction if the employee turns out to have not actually
   worked) apart from "a manager/P&C already cancelled this directly" (a
   final decision on its own, nothing more to confirm).

   cancelled_by/cancelled_at mirror manager_decision_by/pc_confirmed_by's
   existing pattern; cancel_reason is optional free text (unlike
   manager/P&C rejection, nothing in the spec requires a reason to cancel).
   Plain ADD COLUMN, no CHECK constraint — same reasoning as migrations
   022/028/029 (no rebuild needed; cancel_actor_role's allowed values are
   validated in the service layer instead). */
function up(db) {
  const columns = db.prepare('PRAGMA table_info(leave_requests)').all().map((c) => c.name);
  if (!columns.includes('cancelled_by')) {
    db.exec('ALTER TABLE leave_requests ADD COLUMN cancelled_by INTEGER REFERENCES employees(id);');
  }
  if (!columns.includes('cancel_actor_role')) {
    db.exec('ALTER TABLE leave_requests ADD COLUMN cancel_actor_role TEXT;');
  }
  if (!columns.includes('cancelled_at')) {
    db.exec('ALTER TABLE leave_requests ADD COLUMN cancelled_at DATETIME;');
  }
  if (!columns.includes('cancel_reason')) {
    db.exec('ALTER TABLE leave_requests ADD COLUMN cancel_reason TEXT;');
  }
}

module.exports = { up };
