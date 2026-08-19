/* Mirrors server/src/modules/employees/services/timeOffRules.js's
   LEAVE_TYPE_LABELS + notice-window rules — UI copy only, not a second
   source of business logic (the server re-validates/re-computes every
   auto-reject decision independently; this is display text). */
export const LEAVE_TYPES = [
  { value: 'planned', label: 'Planned Leave (PTO)', icon: '🏖️', notice: '3 working days' },
  { value: 'short_notice', label: 'Short-Notice Leave', icon: '⏱️', notice: '1 working day' },
  { value: 'sick', label: 'Sick Leave', icon: '🤒', notice: 'ASAP, same-day OK' },
  { value: 'emergency', label: 'Emergency Leave', icon: '🚨', notice: 'None — same-day OK' },
  { value: 'mental_health', label: 'Mental Health Day', icon: '🧠', notice: '1 working day' },
  { value: 'public_holiday', label: 'Public Holiday', icon: '📅', notice: 'Automatic — no request needed' },
  { value: 'wfh', label: 'Work From Home', icon: '🏠', notice: 'Any time — 1/month quota' },
  { value: 'excuse', label: 'Excuse', icon: '📋', notice: '1 working day' },
  { value: 'unpaid', label: 'Unpaid Leave', icon: '📄', notice: '3 working days' },
];

export function leaveTypeLabel(value) {
  const t = LEAVE_TYPES.find((x) => x.value === value);
  return t ? t.label : value;
}

export const STATUS_LABELS = {
  pending: 'Pending (manager)',
  manager_approved: 'Pending (P&C)',
  approved: 'Approved',
  rejected: 'Rejected',
  auto_rejected: 'Auto-Rejected',
  cancelled: 'Cancelled',
};
