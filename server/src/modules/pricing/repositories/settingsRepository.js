/* company_settings — singleton row (id = 1), only SQL here. Caller
   (settingsService) is responsible for defaulting/validating fields before
   calling upsert; this just persists whatever fully-resolved values it's given. */
const db = require('../../../db');

function get() {
  return db.prepare('SELECT * FROM company_settings WHERE id = 1').get();
}

function upsert({ company, currency, display, defaultHours, defaultUtil, targetMargin, contingency, basis, floorMargin, ratesJson, ratesDate, logo, logoQuote }) {
  db.prepare(`
    INSERT INTO company_settings (
      id, company, currency, display, default_hours, default_util,
      target_margin, contingency, basis, floor_margin, rates_json, rates_date, logo, logo_quote
    ) VALUES (1, @company, @currency, @display, @defaultHours, @defaultUtil,
      @targetMargin, @contingency, @basis, @floorMargin, @ratesJson, @ratesDate, @logo, @logoQuote)
    ON CONFLICT(id) DO UPDATE SET
      company = excluded.company,
      currency = excluded.currency,
      display = excluded.display,
      default_hours = excluded.default_hours,
      default_util = excluded.default_util,
      target_margin = excluded.target_margin,
      contingency = excluded.contingency,
      basis = excluded.basis,
      floor_margin = excluded.floor_margin,
      rates_json = excluded.rates_json,
      rates_date = excluded.rates_date,
      logo = excluded.logo,
      logo_quote = excluded.logo_quote
  `).run({ company, currency, display, defaultHours, defaultUtil, targetMargin, contingency, basis, floorMargin, ratesJson, ratesDate, logo, logoQuote });
  return get();
}

module.exports = { get, upsert };
