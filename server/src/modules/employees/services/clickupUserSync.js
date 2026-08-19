/* One-off/boot-time reconciliation: matches this workspace's ClickUp
   members to our employees by email, populating employees.clickup_user_id
   so the leave-request ClickUp sync (clickupLeaveSync.js) can fill in the
   Employee/Manager/HandOver "users"-type custom fields. Idempotent — safe
   to run every boot, same spirit as kpiDefinitionRepository.seedMany().
   Employees with no matching ClickUp member are left null and logged, not
   treated as an error; the leave-request sync just omits that field for
   them (see clickupLeaveSync.js's own handling of a missing clickup_user_id). */
const logger = require('../../../common/logger');

function createClickupUserSync({ employeeRepository, clickupClient, teamId }) {
  async function run() {
    let membersByEmail;
    try {
      const { teams } = await clickupClient.clickupGet('/team');
      const team = teams.find((t) => String(t.id) === String(teamId)) || teams[0];
      membersByEmail = new Map((team.members || []).map((m) => [String(m.user.email).toLowerCase(), m.user.id]));
    } catch (error) {
      logger.error('ClickUp user sync: could not fetch team members, skipping this run.', { error: error.message });
      return;
    }

    const employees = employeeRepository.findAll();
    let matched = 0;
    const unmatched = [];
    for (const employee of employees) {
      const clickupUserId = membersByEmail.get(String(employee.user_email).toLowerCase());
      if (clickupUserId && String(clickupUserId) !== String(employee.clickup_user_id)) {
        employeeRepository.setClickupUserId(employee.id, String(clickupUserId));
        matched += 1;
      } else if (!clickupUserId) {
        unmatched.push(employee.user_email);
      }
    }

    if (matched > 0) logger.info(`ClickUp user sync: updated clickup_user_id for ${matched} employee(s).`);
    if (unmatched.length > 0) {
      logger.info(`ClickUp user sync: no matching ClickUp member for ${unmatched.length} employee(s).`, { emails: unmatched });
    }
  }

  return { run };
}

module.exports = createClickupUserSync;
