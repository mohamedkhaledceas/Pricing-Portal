const { numOrDefault } = require('./numericField');

function createSettingsService({ settingsRepository, settingsModel, audit }) {
  function get() {
    return settingsModel.toSettings(settingsRepository.get());
  }

  // Shallow-merge, same as the legacy PUT /api/settings — the audit
  // `after` deliberately stays the raw incoming patch (not the merged
  // result), matching what that route always recorded.
  function update({ patch, actorId, actorEmail, ip }) {
    const before = settingsModel.toSettings(settingsRepository.get());
    const merged = { ...before, ...patch };
    const updatedRow = settingsRepository.upsert({
      company: merged.company || '',
      currency: merged.currency || 'EGP',
      display: merged.display || merged.currency || 'EGP',
      defaultHours: numOrDefault(merged.defaultHours, 176, 'defaultHours'),
      defaultUtil: numOrDefault(merged.defaultUtil, 70, 'defaultUtil'),
      targetMargin: numOrDefault(merged.targetMargin, 35, 'targetMargin'),
      contingency: numOrDefault(merged.contingency, 10, 'contingency'),
      basis: merged.basis || 'recovery',
      floorMargin: numOrDefault(merged.floorMargin, 15, 'floorMargin'),
      ratesJson: JSON.stringify(merged.rates || { EGP: 1 }),
      ratesDate: merged.ratesDate || '',
      logo: merged.logo || null,
      logoQuote: merged.logoQuote === false ? 0 : 1,
    });
    const after = settingsModel.toSettings(updatedRow);
    audit.record({
      userId: actorId,
      username: actorEmail,
      action: 'company_settings.update',
      entityType: 'company_settings',
      entityId: '1',
      details: { before, after: patch },
      ip,
    });
    return after;
  }

  return { get, update };
}

module.exports = createSettingsService;
