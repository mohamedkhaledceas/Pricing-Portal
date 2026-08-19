const { EmployeesError } = require('../errors');

/* Data-layer only this pass — see conflictPairRepository.js and the plan's
   §8. This service lets P&C maintain the pair list; it is NOT called from
   timeOffService.submit(), and no enforcement rule (warning, blocking, or
   otherwise) is implemented here. Adding that later is additive: one new
   call in timeOffService, no schema change. */
function createConflictPairService({ conflictPairRepository, conflictPairModel, employeeRepository, roles }) {
  function requireCanManage({ actorAuthRole }) {
    const allowed = actorAuthRole === roles.ADMIN || actorAuthRole === roles.PEOPLE_CULTURE;
    if (!allowed) {
      throw new EmployeesError('You do not have permission to manage conflict pairs.', 403);
    }
  }

  function list({ actorAuthRole }) {
    requireCanManage({ actorAuthRole });
    return conflictPairRepository.findAll().map(conflictPairModel.toConflictPair);
  }

  function create({ actorAuthRole, employeeIdA, employeeIdB }) {
    requireCanManage({ actorAuthRole });
    if (!employeeIdA || !employeeIdB || employeeIdA === employeeIdB) {
      throw new EmployeesError('Two distinct employees are required.');
    }
    if (!employeeRepository.findById(employeeIdA) || !employeeRepository.findById(employeeIdB)) {
      throw new EmployeesError('One or both employees were not found.');
    }
    return conflictPairModel.toConflictPair(conflictPairRepository.insert({ employeeIdA, employeeIdB }));
  }

  function setActive({ actorAuthRole, id, active }) {
    requireCanManage({ actorAuthRole });
    return conflictPairModel.toConflictPair(conflictPairRepository.setActive(id, active));
  }

  return { list, create, setActive };
}

module.exports = createConflictPairService;
