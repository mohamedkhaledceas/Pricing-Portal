const { ValidationError } = require('../../../../common/errors');
const snapshotRepository = require('../repositories/mockSnapshotRepository');

function assertValidEntity(entityKey) {
  if (!snapshotRepository.getEntityKeys().includes(entityKey)) {
    throw new ValidationError(`Unknown entity "${entityKey}".`);
  }
}

function getEntityKeys() {
  return snapshotRepository.getEntityKeys();
}

/* Shell (as-of label, sync status) plus one entity's data, so the frontend
   never has to fetch entities it isn't currently viewing. */
function getSnapshot(entityKey) {
  assertValidEntity(entityKey);
  return {
    ...snapshotRepository.getShell(),
    entity: snapshotRepository.getEntitySnapshot(entityKey),
  };
}

function getBrief(entityKey) {
  assertValidEntity(entityKey);
  const brief = snapshotRepository.getBrief(entityKey);
  if (!brief) throw new ValidationError(`No brief available for entity "${entityKey}".`);
  return brief;
}

module.exports = { getEntityKeys, getSnapshot, getBrief };
