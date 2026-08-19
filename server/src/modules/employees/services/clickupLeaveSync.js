/* Server-side ClickUp sync for leave requests — replaces the old
   prototype's client-side writes (hardcoded API key shipped to the
   browser) with the same field mapping, done here instead. See
   clickupLeaveConstants.js for where the field/option IDs came from.

   Every exported method catches its own errors and logs rather than
   throwing — a ClickUp outage must never block or corrupt the internal
   approval workflow (confirmed decision: fire-and-log). Callers get
   `null` back on failure and just skip storing/acting on it; the
   database stays the source of truth regardless of ClickUp's
   availability. */
const logger = require('../../../common/logger');
const defaults = require('./clickupLeaveConstants');

function createClickupLeaveSync({ clickupClient, employeeRepository, timeOffRules, config } = {}) {
  const LIST_ID = (config && config.listId) || defaults.LEAVE_REQUEST_LIST_ID;
  const CF = (config && config.cf) || defaults.CF;
  const REQUEST_TYPE_OPTIONS = (config && config.requestTypeOptions) || defaults.REQUEST_TYPE_OPTIONS;
  const SALARY_DEDUCTION_OPTIONS = (config && config.salaryDeductionOptions) || defaults.SALARY_DEDUCTION_OPTIONS;
  const EXPECTED_AVAILABILITY_OPTIONS = (config && config.expectedAvailabilityOptions) || defaults.EXPECTED_AVAILABILITY_OPTIONS;
  const LEAVE_STATUS_OPTIONS = (config && config.leaveStatusOptions) || defaults.LEAVE_STATUS_OPTIONS;

  function usersFieldValue(clickupUserId) {
    return clickupUserId ? { add: [Number(clickupUserId)], rem: [] } : undefined;
  }

  function dateFieldValueMs(dateOnlyString) {
    if (!dateOnlyString) return undefined;
    return new Date(`${dateOnlyString}T00:00:00Z`).getTime();
  }

  function buildCustomFields({ leaveRequest }) {
    const fields = [];
    // Skips a field entirely if either its id isn't configured (e.g. a
    // partial config pointed at a list that doesn't have every field —
    // see clickupLeaveConstants.js and how tests point this at a sandbox
    // list with only a subset of fields replicated) or there's no value to
    // set (e.g. no matching option for a leave type ClickUp doesn't have
    // an equivalent for yet).
    const push = (id, value) => {
      if (id !== undefined && id !== null && value !== undefined && value !== null) fields.push({ id, value });
    };

    push(CF.REQUEST_TYPE, REQUEST_TYPE_OPTIONS[leaveRequest.leaveType]);
    push(
      CF.EXPECTED_AVAILABILITY,
      leaveRequest.halfDay ? EXPECTED_AVAILABILITY_OPTIONS[leaveRequest.halfDayPeriod] : EXPECTED_AVAILABILITY_OPTIONS.full_day
    );
    const start = new Date(`${leaveRequest.startDate}T00:00:00`);
    const end = new Date(`${leaveRequest.endDate}T00:00:00`);
    push(CF.TOTAL_DAYS, String(timeOffRules.countWorkingDaysInclusive(start, end)));
    push(CF.POSTING_DATE, Date.now());
    push(CF.LEAVE_STATUS, LEAVE_STATUS_OPTIONS[leaveRequest.status]);
    if (leaveRequest.salaryDeduction && leaveRequest.salaryDeduction !== 'none') {
      push(CF.SALARY_DEDUCT, SALARY_DEDUCTION_OPTIONS[leaveRequest.salaryDeduction]);
    }
    if (leaveRequest.leaveType === 'wfh') {
      push(CF.WFH_DATES, dateFieldValueMs(leaveRequest.startDate));
      push(CF.WFH_REASON, leaveRequest.reason);
    }
    // "users"-type fields (Employee/Manager/HandOver) are deliberately NOT
    // included here — confirmed empirically that ClickUp intermittently
    // drops a "users" field's value when it's bundled into the same
    // request as other custom_fields on task creation (worked reliably
    // alone or via the separate field-update endpoint, silently failed
    // maybe 1 time in 4 when bundled — no error, just an empty value on
    // read-back). setUsersFields() below sets them as individual follow-up
    // calls after the task exists instead.
    return fields;
  }

  async function setUsersFields(taskId, { employee, managerEmployee, handoverEmployee }) {
    const assignments = [
      [CF.EMPLOYEE, employee && employee.clickup_user_id],
      [CF.MANAGER, managerEmployee && managerEmployee.clickup_user_id],
      [CF.HANDOVER, handoverEmployee && handoverEmployee.clickup_user_id],
    ];
    for (const [fieldId, clickupUserId] of assignments) {
      const value = usersFieldValue(clickupUserId);
      if (!fieldId || !value) continue;
      try {
        await clickupClient.clickupPost(`/task/${taskId}/field/${fieldId}`, { value });
      } catch (error) {
        // One field failing to set shouldn't be treated as the whole sync
        // failing — the task itself already exists with everything else on
        // it. Logged, not thrown.
        logger.error('ClickUp leave sync: setting a users-type field failed.', { error: error.message, taskId, fieldId });
      }
    }
  }

  /* Creates the ClickUp task for a just-submitted request. Returns the new
     task's id (to be stored as leave_requests.clickup_task_id), or null on
     any failure (ClickUp unreachable, misconfigured field/option id, etc). */
  async function createTask(leaveRequest) {
    try {
      const employee = employeeRepository.findById(leaveRequest.employeeId);
      if (!employee) throw new Error(`No employee record for id ${leaveRequest.employeeId}`);
      const managerEmployee = employee.manager_employee_id ? employeeRepository.findById(employee.manager_employee_id) : null;
      const handoverEmployee = leaveRequest.handoverEmployeeId ? employeeRepository.findById(leaveRequest.handoverEmployeeId) : null;

      const name = `${employee.user_first_name} ${employee.user_last_name} — ${leaveRequest.leaveType} (${leaveRequest.startDate})`;
      const descriptionParts = [];
      if (leaveRequest.reason) descriptionParts.push(`Reason: ${leaveRequest.reason}`);
      if (handoverEmployee) descriptionParts.push(`Handover: ${handoverEmployee.user_first_name} ${handoverEmployee.user_last_name}`);
      if (managerEmployee) descriptionParts.push(`Manager: ${managerEmployee.user_first_name} ${managerEmployee.user_last_name}`);

      const task = await clickupClient.clickupPost(`/list/${LIST_ID}/task`, {
        name,
        description: descriptionParts.join('\n'),
        custom_fields: buildCustomFields({ leaveRequest }),
      });
      await setUsersFields(task.id, { employee, managerEmployee, handoverEmployee });
      return task.id;
    } catch (error) {
      logger.error('ClickUp leave sync: createTask failed.', { error: error.message, leaveRequestId: leaveRequest.id });
      return null;
    }
  }

  /* Updates just the Leave Status field on an existing task — used on
     manager decision and P&C confirmation. No-op (returns false) if the
     request has no clickup_task_id (createTask failed earlier, or this
     request predates the integration), so callers can call this
     unconditionally without checking first. */
  async function updateStatus(clickupTaskId, internalStatus) {
    if (!clickupTaskId) return false;
    const optionId = LEAVE_STATUS_OPTIONS[internalStatus];
    if (!optionId) return false;
    try {
      await clickupClient.clickupPost(`/task/${clickupTaskId}/field/${CF.LEAVE_STATUS}`, { value: optionId });
      return true;
    } catch (error) {
      logger.error('ClickUp leave sync: updateStatus failed.', { error: error.message, clickupTaskId, internalStatus });
      return false;
    }
  }

  return { createTask, updateStatus };
}

module.exports = createClickupLeaveSync;
