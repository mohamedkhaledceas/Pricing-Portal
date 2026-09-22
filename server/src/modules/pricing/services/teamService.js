const { numOrDefault } = require('./numericField');
const { PricingError } = require('../errors');

// All three mutating endpoints (create/update/remove) return the full,
// current team list — matching the legacy routes' own response contract,
// which the frontend depends on.
function createTeamService({ teamRepository, teamMemberModel, projectLineRepository, unitOfWork, audit, generateId }) {
  function list() {
    return teamRepository.findAll().map(teamMemberModel.toTeamMember);
  }

  function create({ data, actorId, actorEmail, ip }) {
    const id = data.id || generateId('team');
    const created = teamRepository.insert({
      id,
      name: data.name || '',
      role: data.role || '',
      salary: numOrDefault(data.salary, 0, 'salary'),
      extras: numOrDefault(data.extras, 0, 'extras'),
      hours: numOrDefault(data.hours, 176, 'hours'),
      util: numOrDefault(data.util, 70, 'util'),
      override: numOrDefault(data.override, null, 'override'),
      currency: data.cur || 'EGP',
    });
    const member = teamMemberModel.toTeamMember(created);
    audit.record({ userId: actorId, username: actorEmail, action: 'team_member.create', entityType: 'team_member', entityId: member.id, details: { after: member }, ip });
    return list();
  }

  function update({ id, patch, actorId, actorEmail, ip }) {
    const existingRow = teamRepository.findById(id);
    if (!existingRow) throw new PricingError('Team member not found.', 404);
    const before = teamMemberModel.toTeamMember(existingRow);
    const merged = { ...before, ...patch };
    const updatedRow = teamRepository.update(id, {
      name: merged.name || '',
      role: merged.role || '',
      salary: numOrDefault(merged.salary, 0, 'salary'),
      extras: numOrDefault(merged.extras, 0, 'extras'),
      hours: numOrDefault(merged.hours, 176, 'hours'),
      util: numOrDefault(merged.util, 70, 'util'),
      override: numOrDefault(merged.override, null, 'override'),
      currency: merged.cur || 'EGP',
    });
    const after = teamMemberModel.toTeamMember(updatedRow);
    audit.record({ userId: actorId, username: actorEmail, action: 'team_member.update', entityType: 'team_member', entityId: id, details: { before, after }, ip });
    return list();
  }

  // No 404 on a missing id — same as the legacy route, which always
  // returned 200 with the current list regardless of whether anything was
  // actually removed.
  function remove({ id, actorId, actorEmail, ip }) {
    const existingRow = teamRepository.findById(id);
    const before = existingRow ? teamMemberModel.toTeamMember(existingRow) : null;
    unitOfWork.transaction(() => {
      teamRepository.remove(id);
      // project_lines.person_id has no FK to team_members — strip any
      // dangling references left behind by this delete.
      projectLineRepository.clearPersonReferences(id);
    });
    audit.record({ userId: actorId, username: actorEmail, action: 'team_member.delete', entityType: 'team_member', entityId: id, details: { before }, ip });
    return list();
  }

  return { list, create, update, remove };
}

module.exports = createTeamService;
