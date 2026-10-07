/* The Control Room's saved KPI targets and hand-entered KPIs (phase 3.2).

   Targets are per view — 'ceas', 'fze', 'lwm', 'all' — each in that
   view's own currency, and start empty (user decision 2026-10-06). A
   target is a number or null (cleared). Only ceo and admin may change
   targets or add/remove KPIs; that is decided here, not on the page.

   A KPI id must be one the Control Room knows (the registry's ids) or an
   active custom KPI of the same view. Every change is audited. */
const { AppError, ValidationError } = require('../../../../common/errors');
const { ROLES } = require('../../../../common/constants/roles');

const ENTITIES = ['ceas', 'fze', 'lwm', 'all'];
const EDIT_ROLES = [ROLES.CEO, ROLES.ADMIN];
const UNITS = ['egp', 'pct', 'days', 'count', 'ratio', 'months'];
const DIRECTIONS = ['higher_better', 'lower_better'];
const TARGET_TYPES = ['min', 'max', 'exact'];
const MAX_ABS = 1e12;

function optionalNumber(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) >= MAX_ABS) {
    throw new ValidationError(`"${label}" must be a number (or empty).`);
  }
  return n;
}

function cleanNote(note) {
  if (note == null || note === '') return null;
  if (typeof note !== 'string' || note.length > 300) throw new ValidationError('"note" must be text of 300 characters or fewer.');
  return note.trim() || null;
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new ValidationError(`"${label}" must be one of: ${allowed.join(', ')}.`);
  return value;
}

function createTargetService({ targetRepository, transaction, audit, knownKpiIds, componentIds }) {
  const known = new Set(knownKpiIds);

  function requireEditor(actor) {
    if (!EDIT_ROLES.includes(actor.role)) throw new AppError('Only the CEO or an admin can change targets and KPIs.', 403);
  }

  // custom_<id> of this view, still active → its row id; otherwise null.
  function customRow(entity, kpiId) {
    const m = /^custom_(\d{1,9})$/.exec(kpiId);
    return m ? targetRepository.findCustom(entity, Number(m[1])) : null;
  }

  function getState(entity) {
    oneOf(entity, ENTITIES, 'entity');
    return {
      targets: Object.fromEntries(targetRepository.listTargets(entity).map((t) => [t.kpiId, t.target])),
      custom: targetRepository.listCustom(entity),
    };
  }

  function setTarget({ actor, entity, kpiId, target, note, ip }) {
    requireEditor(actor);
    oneOf(entity, ENTITIES, 'entity');
    if (typeof kpiId !== 'string' || kpiId.length > 60) throw new ValidationError('"kpiId" is not a KPI.');
    if (!known.has(kpiId) && !customRow(entity, kpiId)) throw new AppError(`No KPI "${kpiId}" in this view.`, 404);
    const value = optionalNumber(target, 'target');
    const why = cleanNote(note);
    const before = targetRepository.findTarget(entity, kpiId);
    const was = before ? before.target : null;
    if (was === value) return { entity, kpiId, target: value, unchanged: true };
    targetRepository.upsertTarget(entity, kpiId, value, actor.id);
    audit.record({
      userId: actor.id,
      action: 'control_room.kpi_target.update',
      entityType: 'control_room_kpi_target',
      entityId: `${entity}:${kpiId}`,
      details: { entity, kpiId, from: was, to: value, note: why },
      ip,
    });
    return { entity, kpiId, target: value };
  }

  function addCustomKpi({ actor, entity, name, unit, direction, targetType, component, actual, target, ip }) {
    requireEditor(actor);
    oneOf(entity, ENTITIES, 'entity');
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new ValidationError('"name" must be 1–80 characters.');
    const fields = {
      entity,
      name: name.trim(),
      unit: oneOf(unit, UNITS, 'unit'),
      direction: oneOf(direction, DIRECTIONS, 'direction'),
      targetType: oneOf(targetType, TARGET_TYPES, 'targetType'),
      component: oneOf(component, componentIds, 'component'),
      actual: optionalNumber(actual, 'actual'),
    };
    const value = optionalNumber(target, 'target');
    const kpi = transaction(() => {
      const created = targetRepository.insertCustom(fields, actor.id);
      if (value !== null) targetRepository.upsertTarget(entity, created.key, value, actor.id);
      return created;
    });
    audit.record({
      userId: actor.id,
      action: 'control_room.custom_kpi.create',
      entityType: 'control_room_custom_kpi',
      entityId: String(kpi.id),
      details: { ...fields, target: value },
      ip,
    });
    return { ...kpi, target: value };
  }

  function archiveCustomKpi({ actor, entity, kpiId, ip }) {
    requireEditor(actor);
    oneOf(entity, ENTITIES, 'entity');
    const row = typeof kpiId === 'string' ? customRow(entity, kpiId) : null;
    if (!row) throw new AppError('No such added KPI in this view.', 404);
    targetRepository.archiveCustom(row.id);
    audit.record({
      userId: actor.id,
      action: 'control_room.custom_kpi.archive',
      entityType: 'control_room_custom_kpi',
      entityId: String(row.id),
      details: { entity, name: row.name },
      ip,
    });
    return { entity, kpiId, archived: true };
  }

  return { getState, setTarget, addCustomKpi, archiveCustomKpi };
}

module.exports = createTargetService;
