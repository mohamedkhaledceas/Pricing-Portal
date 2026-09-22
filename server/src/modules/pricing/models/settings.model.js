// Exact same shape as the legacy db.js's serializeSettings() — marginPlannerSummary.js
// and the frontend (modules/pricing/views/js/settingsPanel.js) both depend on these exact field names.
function toSettings(row) {
  const rates = row && row.rates_json ? JSON.parse(row.rates_json || '{}') : { EGP: 1 };
  return {
    company: row?.company || '',
    currency: row?.currency || 'EGP',
    display: row?.display || row?.currency || 'EGP',
    defaultHours: Number(row?.default_hours ?? 176),
    defaultUtil: Number(row?.default_util ?? 70),
    targetMargin: Number(row?.target_margin ?? 35),
    contingency: Number(row?.contingency ?? 10),
    basis: row?.basis || 'recovery',
    floorMargin: Number(row?.floor_margin ?? 15),
    rates,
    ratesDate: row?.rates_date || '',
    logo: row?.logo || null,
    logoQuote: row?.logo_quote !== 0,
  };
}

module.exports = { toSettings };
