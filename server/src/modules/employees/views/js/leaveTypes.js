/* Mirrors server/src/modules/employees/services/timeOffRules.js's
   LEAVE_TYPE_LABELS + notice-window rules — UI copy only, not a second
   source of business logic (the server re-validates/re-computes every
   auto-reject decision independently; this is display text). */
export const LEAVE_TYPES = [
  { value: 'planned', label: 'Planned Leave (PTO)', notice: '3 working days' },
  { value: 'short_notice', label: 'Short-Notice Leave', notice: '1 working day' },
  { value: 'sick', label: 'Sick Leave', notice: 'ASAP, same-day OK' },
  { value: 'emergency', label: 'Emergency Leave', notice: 'None — same-day OK' },
  { value: 'mental_health', label: 'Mental Health Day', notice: '1 working day' },
  { value: 'public_holiday', label: 'Public Holiday', notice: 'Automatic — no request needed' },
  { value: 'wfh', label: 'Work From Home', notice: 'Any time — 1/month quota' },
  { value: 'excuse', label: 'Excuse', notice: '1 working day' },
  { value: 'unpaid', label: 'Unpaid Leave', notice: '3 working days' },
];

export function leaveTypeLabel(value) {
  const t = LEAVE_TYPES.find((x) => x.value === value);
  return t ? t.label : value;
}

// Mirrors server/src/modules/employees/services/timeOffService.js's
// VALID_AVAILABILITY — replaces the old half-day checkbox+period. Describes
// how reachable the requester is during their leave, not the leave's
// duration (that's still just start/end date).
export const AVAILABILITY_OPTIONS = [
  { value: 'full_day', label: 'Full Day' },
  { value: 'partial_day', label: 'Partial Day' },
  { value: 'unavailable', label: 'Unavailable' },
];

export function availabilityLabel(value) {
  const a = AVAILABILITY_OPTIONS.find((x) => x.value === value);
  return a ? a.label : value;
}

// Mirrors server/src/modules/employees/services/leaveBalanceRules.js's
// bucketForType — which of the 4 tracked balance pools a leave type draws
// from. null = uncapped, not tracked (sick, unpaid, public_holiday).
export function balanceBucketForType(leaveType) {
  if (leaveType === 'planned') return 'planned';
  if (['emergency', 'mental_health', 'short_notice'].includes(leaveType)) return 'combined';
  if (leaveType === 'wfh') return 'wfh';
  if (leaveType === 'excuse') return 'excuse';
  return null;
}

export const STATUS_LABELS = {
  pending: 'Pending (manager)',
  manager_approved: 'Pending (P&C)',
  approved: 'Approved',
  rejected: 'Rejected',
  auto_rejected: 'Auto-Rejected',
  cancelled: 'Cancelled',
};
