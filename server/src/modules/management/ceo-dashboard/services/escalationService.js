/* The Control Room's escalation preferences (phase 3.3): which areas'
   decisions come to the CEO, and the sign-off threshold above which any
   decision does. Company-wide. Only ceo and admin may change them —
   decided here, not on the page — and every change is audited. */
const { AppError, ValidationError } = require('../../../../common/errors');
const { ROLES } = require('../../../../common/constants/roles');

const EDIT_ROLES = [ROLES.CEO, ROLES.ADMIN];
const MAX_THRESHOLD = 1e10;

function createEscalationService({ escalationRepository, audit }) {
  function requireEditor(actor) {
    if (!EDIT_ROLES.includes(actor.role)) throw new AppError('Only the CEO or an admin can change escalation preferences.', 403);
  }

  // The page's shape: { money, ceo: { area: 0|1 } }.
  function getPrefs() {
    return {
      money: escalationRepository.getThreshold(),
      ceo: Object.fromEntries(escalationRepository.listRoutes().map((r) => [r.area, r.comesToCeo])),
    };
  }

  function setRoute({ actor, area, comesToCeo, ip }) {
    requireEditor(actor);
    if (typeof comesToCeo !== 'boolean') throw new ValidationError('"comesToCeo" must be true or false.');
    const row = typeof area === 'string' ? escalationRepository.findRoute(area) : null;
    if (!row) throw new AppError(`No escalation area "${area}".`, 404);
    const value = comesToCeo ? 1 : 0;
    if (row.comesToCeo !== value) {
      escalationRepository.updateRoute(area, value, actor.id);
      audit.record({
        userId: actor.id,
        action: 'control_room.escalation.update',
        entityType: 'control_room_escalation_route',
        entityId: area,
        details: { area, from: row.comesToCeo ? 'ceo' : 'head', to: value ? 'ceo' : 'head' },
        ip,
      });
    }
    return getPrefs();
  }

  function setThreshold({ actor, amount, ip }) {
    requireEditor(actor);
    const n = typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : amount;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= MAX_THRESHOLD) {
      throw new ValidationError('"amount" must be a whole number of EGP from 0 to 9,999,999,999.');
    }
    const was = escalationRepository.getThreshold();
    if (was !== n) {
      escalationRepository.updateThreshold(n, actor.id);
      audit.record({
        userId: actor.id,
        action: 'control_room.escalation.update',
        entityType: 'control_room_settings',
        entityId: 'sign_off_threshold',
        details: { from: was, to: n },
        ip,
      });
    }
    return getPrefs();
  }

  return { getPrefs, setRoute, setThreshold };
}

module.exports = createEscalationService;
