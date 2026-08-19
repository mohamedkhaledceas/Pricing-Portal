/* Field/option IDs for the live "Time Off & WFH Request Form" ClickUp list
   (901519113554) — confirmed directly against the list's current field
   definitions (GET /list/{id}/field), not copied from the old prototype's
   hardcoded values without checking. The list also has fields unrelated to
   time off (Client Name, Job Description, etc., left over from other uses
   of the same list) — CF below only names the ones this sync actually
   writes to.

   LEAVE_STATUS_BY_INTERNAL_STATUS maps our leave_requests.status values
   onto the ClickUp option that represents them. Our workflow has both
   'rejected' (P&C's final call) and 'auto_rejected' (notice-window
   auto-reject) — ClickUp only has one "Rejected" option, so both map to
   it; there's no ClickUp-side distinction to preserve. 'manager_approved'
   maps to "Awaiting P&C", the option added specifically for this
   integration (ClickUp's original 4 options had no equivalent — the old
   prototype never had a P&C step at all). 'pending' has no ClickUp write
   of its own; it's simply what the option already is when the task is
   first created. */
const LEAVE_REQUEST_LIST_ID = '901519113554';

const CF = {
  REQUEST_TYPE: '374b04e0-1afc-4f70-9d71-9d553c5a9e93',
  MONTH: 'c7bc015d-5a3d-48e4-82ba-65627fc12856',
  WFH_DATES: 'c35e8d83-7522-440b-b849-ed0e4734585c',
  WFH_REASON: 'e5a1ae22-7e27-4503-a351-f516c2a971c1',
  EMPLOYEE: '98075e75-059b-4e05-96d5-b8cb99769e34',
  DEPARTMENT: '2f5d1a3b-8820-4823-921e-da1803345d1d',
  EXPECTED_AVAILABILITY: '2cc6e67c-fafc-4b7e-9947-b4e592d9a5a5',
  TOTAL_DAYS: 'f73d7ec2-1f56-40f1-9a29-763dbe6bda95',
  POSTING_DATE: 'be70df97-8fd4-44b5-8f82-06372364d9c6',
  LEAVE_STATUS: '785b642a-8656-4f50-932a-cd2285ee0941',
  SALARY_DEDUCT: '13c5770a-62ea-4c17-9190-2ec3d29176ab',
  MANAGER: 'd64f92d3-6af3-4ad5-8c70-5c677e59b70a',
  HANDOVER: '837123f3-a851-460f-a4eb-2580f4336ba6',
};

const REQUEST_TYPE_OPTIONS = {
  planned: 'b087278f-7aca-49ca-bd4f-5e8c5b7e4a46', // "Paid Time Off"
  sick: '79ffa06d-e58d-42f3-ab57-f14b85c45288',
  emergency: '10b7a6e7-79b9-4a2c-bc07-b3bed5947c4d',
  unpaid: '9cdfb25f-6cd6-4d63-a3e7-bc348020a610',
  wfh: 'bfa51051-6bfd-4c49-9267-cd434811113e',
  excuse: 'e76d52fc-1495-46c9-9a8c-50b2950789c9',
  // short_notice and mental_health are new leave types not in the old
  // prototype's option set and have no ClickUp equivalent yet — omitted
  // from the dropdown write (task still gets created, just without this
  // one field set) rather than guessing an option that doesn't exist.
};

const SALARY_DEDUCTION_OPTIONS = {
  none: '4b00378b-69fd-45b7-855b-30e69d13ac28', // "No Deduction"
  half_day: 'ae6472f7-fe2c-4b71-9fea-ae7fd476f72d', // "Late Submission — Possible Deduction"
  full_day: '4f909837-a205-4dc9-b2fe-1fe0eff853a4', // "Deduction Applies"
  unpaid: '4f909837-a205-4dc9-b2fe-1fe0eff853a4', // no distinct "unpaid" option — closest is "Deduction Applies"
};

const EXPECTED_AVAILABILITY_OPTIONS = {
  morning: '74278f02-f85c-4fa4-ad46-fe7555597c61', // "Partial Day" — ClickUp has no AM/PM-specific option
  afternoon: '74278f02-f85c-4fa4-ad46-fe7555597c61',
  full_day: '9579b7bd-174e-4124-a4f3-16ffa293256e',
};

const LEAVE_STATUS_OPTIONS = {
  pending: '42c1495b-a591-43f4-a505-8426eb8e3b62',
  manager_approved: '869d9966-c6b5-4a63-8475-30b97f85e5c6', // "Awaiting P&C"
  approved: 'd0736d77-d382-4ce9-a57b-0940337cb560',
  rejected: '759e5b66-0115-43f3-88f2-38a55291e172',
  auto_rejected: '759e5b66-0115-43f3-88f2-38a55291e172',
  cancelled: '5805cdb1-1241-405c-937f-00da621623a2',
};

module.exports = {
  LEAVE_REQUEST_LIST_ID,
  CF,
  REQUEST_TYPE_OPTIONS,
  SALARY_DEDUCTION_OPTIONS,
  EXPECTED_AVAILABILITY_OPTIONS,
  LEAVE_STATUS_OPTIONS,
};
