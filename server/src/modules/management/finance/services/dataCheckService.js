/* Self-checks run after every full Odoo sync (startup, nightly 03:00).
   They guard the parts of the Control Room that rebuild Odoo's own
   reports, so a figure that has drifted from Odoo is flagged, not trusted:

   - balance_sheet:<entity> — assets equal liabilities + equity (double
     entry guarantees it; a gap means the copy is incomplete).
   - revenue_copies:<entity> — for the EGP companies, this year's invoiced
     revenue agrees between the two invoice copies (odoo_invoices and the
     converted Invoices Analysis), within 1 EGP.
   - report_definitions — Odoo's Profit and Loss (account.report 7) and
     Balance Sheet (4) are still defined as they were when the portal's
     rebuild was verified to the piastre (2026-10-06). An accountant
     editing those reports in Odoo changes the fingerprint; the portal's
     figures then need re-checking.

   Read-only against Odoo. Results land in finance_data_checks. */
const crypto = require('crypto');

// 37 expressions of reports 4 + 7, verified 2026-10-06 (business-portal-tracker §6p).
const VERIFIED_REPORT_FINGERPRINT = '407d238d8f03361dacc6f2d74b203da9bdafe86c302373a18600d0bc6ddfee52';
const REPORT_IDS = [4, 7];

function createDataCheckService({
  odooClient, financeMetricsService, invoiceRepository, invoiceReportRepository, dataCheckRepository, entities,
  consolidationCurrency, logger, today,
}) {
  async function reportFingerprint(companyIds) {
    const lines = await odooClient.searchRead('account.report.line', {
      domain: [['report_id', 'in', REPORT_IDS]], fields: ['id', 'code', 'report_id'], companyIds,
    });
    const code = new Map(lines.map((l) => [l.id, `${l.report_id[0]}:${l.code}`]));
    const expressions = await odooClient.searchRead('account.report.expression', {
      domain: [['report_line_id', 'in', lines.map((l) => l.id)]],
      fields: ['report_line_id', 'label', 'engine', 'formula', 'subformula', 'date_scope'],
      companyIds,
    });
    const canonical = expressions
      .map((e) => [code.get(e.report_line_id[0]), e.label, e.engine, e.formula, e.subformula || '', e.date_scope || ''].join('|'))
      .sort().join('\n');
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  async function run() {
    const at = new Date().toISOString();
    const asOf = today();
    const yearStart = `${asOf.slice(0, 4)}-01-01`;
    const results = [];
    const save = (key, status, detail) => { dataCheckRepository.record(key, status, detail, at); results.push({ key, status, detail }); };

    for (const [key, entity] of Object.entries(entities)) {
      try {
        const b = financeMetricsService.getBalanceSheet(key).balanceSheet;
        save(`balance_sheet:${key}`, b.balances ? 'ok' : 'fail',
          b.balances ? null : `Assets ${b.assets} ≠ liabilities + equity ${b.liabilitiesAndEquity}`);
      } catch (error) { save(`balance_sheet:${key}`, 'error', error.message); }

      if (entity.currency !== consolidationCurrency) continue;
      try {
        const own = invoiceRepository.sumUntaxedByMonth(entity.companyId, yearStart, asOf).reduce((s, m) => s + m.total, 0);
        const report = invoiceReportRepository.sumByMonthForCompany(entity.companyId, yearStart, asOf);
        const gap = Math.abs(own - report);
        save(`revenue_copies:${key}`, gap <= 1 ? 'ok' : 'fail', gap <= 1 ? null : `Invoices ${Math.round(own)} vs Invoices Analysis ${Math.round(report)} (gap ${Math.round(gap)})`);
      } catch (error) { save(`revenue_copies:${key}`, 'error', error.message); }
    }

    try {
      const fp = await reportFingerprint([Object.values(entities)[0].companyId]);
      save('report_definitions', fp === VERIFIED_REPORT_FINGERPRINT ? 'ok' : 'fail', fp === VERIFIED_REPORT_FINGERPRINT ? null
        : 'Odoo\'s Profit and Loss or Balance Sheet definition changed since it was verified — re-check the portal\'s P&L, balance sheet and year figures against Odoo.');
    } catch (error) { save('report_definitions', 'error', error.message); }

    const failing = results.filter((r) => r.status !== 'ok');
    if (failing.length) logger.warn('Odoo data checks: some checks did not pass.', { failing });
    else logger.info('Odoo data checks passed.', { checks: results.length });
    return results;
  }

  return { run, list: () => dataCheckRepository.listAll() };
}

module.exports = createDataCheckService;
