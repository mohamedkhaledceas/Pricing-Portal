/* Copies Odoo invoices and payments into the portal's cache tables
   (docs/adr/0013 §2, §5). Read-only against Odoo.

   Two modes per model:
   - incremental: records whose write_date >= the last one seen. `>=`, not
     `>`, because several records can share a write_date second; upserting
     a few twice is harmless, missing one isn't.
   - full: every record in scope, re-upserted, then local rows Odoo no
     longer has are removed (Odoo deletes draft moves outright).

   Each model's rows + its sync-state row are written in one transaction.
   One model failing is recorded on its own sync-state row and doesn't stop
   the other.

   Partners (res.partner) run after invoices and sales lines, every run,
   both modes: the customers the invoice and sales caches reference are
   re-read by id and the rest are dropped. Not filtered by company — most Odoo partners are shared
   across companies (company_id empty) — the id list already comes from
   company-scoped invoices. A few dozen records, so no incremental mode.

   The Invoices Analysis report (account.invoice.report) runs last, every
   run, both modes: read with all three companies allowed and Ceas Comm
   first, so Odoo itself converts every line into EGP (migration 035), and
   the table is replaced whole — the conversion follows Odoo's rates, so an
   unchanged line can still change value. A few hundred lines.

   Profit and Loss inputs (migration 036) run after it, every run: each
   company's posted journal items on P&L account types for this year and
   last, read company by company (balances stay in that company's
   currency), plus Odoo's dated rates for the other companies' currencies
   as Ceas Comm records them. Both replaced whole; ~1,300 lines.

   Sales Analysis (sale.report, migration 037) runs last, every run: read
   once per company (own currency) and once with all companies (Odoo's EGP
   conversion), joined by line id, replaced whole. ~600 lines. */
const {
  ODOO_INVOICE_FIELDS, ODOO_PAYMENT_FIELDS, ODOO_PARTNER_FIELDS, ODOO_INVOICE_REPORT_FIELDS, ODOO_SALE_REPORT_FIELDS,
  toInvoiceRow, toPaymentRow, toPartnerRow, toInvoiceReportRow, toSaleReportRow,
} = require('../models/odooRecord.model');

const PAGE_SIZE = 500;

function createOdooSyncService({
  odooClient, invoiceRepository, paymentRepository, partnerRepository, invoiceReportRepository, pnlRepository,
  saleReportRepository,
  syncStateRepository, transaction, logger, companyIds, consolidationCompanyIds, consolidationCurrency,
  pnlAccountTypes, foreignCurrencies, today,
}) {
  const SPECS = [
    {
      key: 'account.move',
      model: 'account.move',
      domain: [['move_type', 'in', ['out_invoice', 'out_refund']]],
      fields: ODOO_INVOICE_FIELDS,
      toRow: toInvoiceRow,
      repository: invoiceRepository,
    },
    {
      key: 'account.payment',
      model: 'account.payment',
      domain: [],
      fields: ODOO_PAYMENT_FIELDS,
      toRow: toPaymentRow,
      repository: paymentRepository,
    },
  ];

  async function fetchAll(spec, extraDomain) {
    const domain = [...spec.domain, ['company_id', 'in', companyIds], ...extraDomain];
    const records = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      const page = await odooClient.searchRead(spec.model, {
        domain, fields: spec.fields, order: 'write_date asc, id asc', limit: PAGE_SIZE, offset, companyIds,
      });
      records.push(...page);
      if (page.length < PAGE_SIZE) return records;
    }
  }

  async function syncModel(spec, mode) {
    const runAt = new Date().toISOString();
    try {
      const state = syncStateRepository.findByModel(spec.key);
      const since = mode === 'incremental' && state ? state.lastWriteDate : null;
      const records = await fetchAll(spec, since ? [['write_date', '>=', since]] : []);
      const rows = records.map((record) => spec.toRow(record, runAt));

      const rowWithoutCompany = rows.find((row) => !row.company_id);
      if (rowWithoutCompany) {
        throw new Error(`Odoo ${spec.model} record ${rowWithoutCompany.odoo_id} has no company — refusing to cache it.`);
      }

      const lastWriteDate = rows.reduce((max, row) => (row.odoo_write_date > (max || '') ? row.odoo_write_date : max), null);

      let removed = 0;
      transaction(() => {
        spec.repository.upsertMany(rows);
        if (mode === 'full') {
          const remoteIds = new Set(rows.map((row) => row.odoo_id));
          const localIds = spec.repository.listIdsByCompanies(companyIds);
          // An empty Odoo answer while we hold rows is far more likely a
          // permissions/scope problem than every record being deleted —
          // keep the cache rather than wipe it.
          if (remoteIds.size === 0 && localIds.length > 0) {
            logger.warn('Odoo full sync returned no records while the cache has some — skipping removal.', { model: spec.model, cached: localIds.length });
          } else {
            const missing = localIds.filter((id) => !remoteIds.has(id));
            spec.repository.removeByIds(missing);
            removed = missing.length;
          }
        }
        syncStateRepository.recordSuccess(spec.key, { lastWriteDate, recordsSynced: rows.length, runAt });
      });

      return { model: spec.model, mode, status: 'ok', upserted: rows.length, removed };
    } catch (error) {
      syncStateRepository.recordFailure(spec.key, { error: error.message, runAt });
      logger.error('Odoo sync failed for model.', { model: spec.model, mode, message: error.message });
      return { model: spec.model, mode, status: 'error', error: error.message };
    }
  }

  async function syncPartners() {
    const model = 'res.partner';
    const runAt = new Date().toISOString();
    try {
      // Customers on invoices, and on quotations/orders that were never
      // invoiced — the Control Room opens both in its client drawer.
      const ids = [...new Set([...invoiceRepository.listPartnerIds(), ...saleReportRepository.listPartnerIds()])];
      const records = [];
      for (let i = 0; i < ids.length; i += PAGE_SIZE) {
        // eslint-disable-next-line no-await-in-loop
        records.push(...await odooClient.searchRead(model, {
          // Archived customers still own historical invoices.
          domain: [['id', 'in', ids.slice(i, i + PAGE_SIZE)], ['active', 'in', [true, false]]],
          fields: ODOO_PARTNER_FIELDS,
          companyIds,
        }));
      }
      const rows = records.map((record) => toPartnerRow(record, runAt));
      const remoteIds = new Set(rows.map((row) => row.odoo_id));
      let removed = 0;
      transaction(() => {
        partnerRepository.upsertMany(rows);
        // Same guard as syncModel's full mode: never wipe on an empty answer.
        if (remoteIds.size > 0) {
          const missing = partnerRepository.listIds().filter((id) => !remoteIds.has(id));
          partnerRepository.removeByIds(missing);
          removed = missing.length;
        }
        syncStateRepository.recordSuccess(model, { lastWriteDate: null, recordsSynced: rows.length, runAt });
      });
      return { model, mode: 'by-reference', status: 'ok', upserted: rows.length, removed };
    } catch (error) {
      syncStateRepository.recordFailure(model, { error: error.message, runAt });
      logger.error('Odoo sync failed for model.', { model, message: error.message });
      return { model, mode: 'by-reference', status: 'error', error: error.message };
    }
  }

  async function syncInvoiceReport() {
    const model = 'account.invoice.report';
    const runAt = new Date().toISOString();
    try {
      const records = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        // eslint-disable-next-line no-await-in-loop
        const page = await odooClient.searchRead(model, {
          domain: [['state', 'not in', ['draft', 'cancel']], ['move_type', 'in', ['out_invoice', 'out_refund']]],
          fields: ODOO_INVOICE_REPORT_FIELDS,
          order: 'id asc',
          limit: PAGE_SIZE,
          offset,
          companyIds: consolidationCompanyIds,
        });
        records.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      // The line's currency_id is the invoice's own currency, not the one
      // Odoo converted into — that is the first allowed company's (EGP).
      const rows = records.map((record) => toInvoiceReportRow(record, runAt, consolidationCurrency));
      transaction(() => {
        // Same guard as the other syncs: never wipe on an empty answer.
        if (rows.length === 0 && invoiceReportRepository.countAll() > 0) {
          logger.warn('Odoo invoice report returned no lines while the cache has some — keeping the cache.');
        } else {
          invoiceReportRepository.replaceAll(rows);
        }
        syncStateRepository.recordSuccess(model, { lastWriteDate: null, recordsSynced: rows.length, runAt });
      });
      return { model, mode: 'replace', status: 'ok', upserted: rows.length, removed: 0 };
    } catch (error) {
      syncStateRepository.recordFailure(model, { error: error.message, runAt });
      logger.error('Odoo sync failed for model.', { model, message: error.message });
      return { model, mode: 'replace', status: 'error', error: error.message };
    }
  }

  async function readAll(model, params) {
    const records = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      const page = await odooClient.searchRead(model, { ...params, order: 'id asc', limit: PAGE_SIZE, offset });
      records.push(...page);
      if (page.length < PAGE_SIZE) return records;
    }
  }

  async function syncPnl() {
    const model = 'account.move.line (P&L)';
    const runAt = new Date().toISOString();
    try {
      const from = `${Number(today().slice(0, 4)) - 1}-01-01`;
      const lines = [];
      for (const companyId of companyIds) {
        // eslint-disable-next-line no-await-in-loop
        const records = await readAll('account.move.line', {
          domain: [['company_id', '=', companyId], ['parent_state', '=', 'posted'], ['date', '>=', from],
            ['account_type', 'in', pnlAccountTypes]],
          fields: ['id', 'company_id', 'date', 'account_type', 'balance'],
          companyIds: [companyId],
        });
        lines.push(...records.map((r) => ({
          odoo_id: r.id, company_id: companyId, date: r.date, account_type: r.account_type, balance: r.balance || 0, synced_at: runAt,
        })));
      }
      // Read as Ceas Comm, the consolidation company, so these are the rates
      // Odoo itself uses when it converts into EGP.
      const rates = await readAll('res.currency.rate', {
        domain: [['currency_id.name', 'in', foreignCurrencies]],
        fields: ['id', 'name', 'currency_id', 'inverse_company_rate'],
        companyIds: [consolidationCompanyIds[0]],
      });
      const rateRows = rates.map((r) => ({
        odoo_id: r.id, currency: r.currency_id[1], date: r.name, inverse_rate: r.inverse_company_rate, synced_at: runAt,
      }));
      transaction(() => {
        // Same guard as the other syncs: never wipe on an empty answer.
        if (lines.length === 0 && pnlRepository.countLines() > 0) {
          logger.warn('Odoo P&L lines came back empty while the cache has some — keeping the cache.');
        } else {
          pnlRepository.replaceLines(lines);
        }
        if (rateRows.length) pnlRepository.replaceRates(rateRows);
        syncStateRepository.recordSuccess(model, { lastWriteDate: null, recordsSynced: lines.length, runAt });
      });
      return { model, mode: 'replace', status: 'ok', upserted: lines.length, removed: 0 };
    } catch (error) {
      syncStateRepository.recordFailure(model, { error: error.message, runAt });
      logger.error('Odoo sync failed for model.', { model, message: error.message });
      return { model, mode: 'replace', status: 'error', error: error.message };
    }
  }

  async function syncSaleReport() {
    const model = 'sale.report';
    const runAt = new Date().toISOString();
    try {
      const own = [];
      for (const companyId of companyIds) {
        // eslint-disable-next-line no-await-in-loop
        own.push(...await readAll(model, {
          domain: [['company_id', '=', companyId]], fields: ODOO_SALE_REPORT_FIELDS, companyIds: [companyId],
        }));
      }
      const consolidated = new Map((await readAll(model, {
        domain: [], fields: ['id', 'price_subtotal', 'untaxed_amount_to_invoice'], companyIds: consolidationCompanyIds,
      })).map((r) => [r.id, r]));
      const rows = own.map((r) => toSaleReportRow(r, consolidated.get(r.id), runAt));
      transaction(() => {
        // Same guard as the other syncs: never wipe on an empty answer.
        if (rows.length === 0 && saleReportRepository.countAll() > 0) {
          logger.warn('Odoo sales report returned no lines while the cache has some — keeping the cache.');
        } else {
          saleReportRepository.replaceAll(rows);
        }
        syncStateRepository.recordSuccess(model, { lastWriteDate: null, recordsSynced: rows.length, runAt });
      });
      return { model, mode: 'replace', status: 'ok', upserted: rows.length, removed: 0 };
    } catch (error) {
      syncStateRepository.recordFailure(model, { error: error.message, runAt });
      logger.error('Odoo sync failed for model.', { model, message: error.message });
      return { model, mode: 'replace', status: 'error', error: error.message };
    }
  }

  async function run(mode) {
    const results = [];
    for (const spec of SPECS) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await syncModel(spec, mode));
    }
    // Sales lines before partners: the partner sync reads their customers.
    results.push(await syncSaleReport());
    results.push(await syncPartners());
    results.push(await syncInvoiceReport());
    results.push(await syncPnl());
    return results;
  }

  return {
    runIncremental: () => run('incremental'),
    runFull: () => run('full'),
    getSyncState: () => syncStateRepository.listAll(),
  };
}

module.exports = createOdooSyncService;
