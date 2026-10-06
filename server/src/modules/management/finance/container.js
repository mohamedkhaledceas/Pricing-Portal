/* Composition root for management/finance — wires odooClient +
   repositories -> odooSyncService -> schedule; the same repositories ->
   financeMetricsService (read by the CEO dashboard, ADR-0013 §10 — never
   the repositories directly); and clientMappingService -> controller ->
   router for the client-mapping review (§8). */
const config = require('../../../config');
const logger = require('../../../common/logger');
const audit = require('../../../common/audit');
const { authenticate } = require('../../auth');
const odooClient = require('../../../common/integrations/odooClient');

const invoiceRepository = require('./repositories/odooInvoiceRepository');
const paymentRepository = require('./repositories/odooPaymentRepository');
const partnerRepository = require('./repositories/odooPartnerRepository');
const syncStateRepository = require('./repositories/odooSyncStateRepository');
const invoiceReportRepository = require('./repositories/odooInvoiceReportRepository');
const clientRepository = require('./repositories/clientRepository');
const linkRepository = require('./repositories/clientOdooLinkRepository');
const { transaction } = require('./repositories/unitOfWork');

const createOdooSyncService = require('./services/odooSyncService');
const createFinanceMetricsService = require('./services/financeMetricsService');
const createCustomerLedgerService = require('./services/customerLedgerService');
const createClientMappingService = require('./services/clientMappingService');
const createClientMappingController = require('./controllers/clientMappingController');
const createFinanceRouter = require('./routes/index');
const { startOdooSyncSchedule } = require('./jobs/odooSyncSchedule');
const { SYNCED_COMPANY_IDS, CONSOLIDATION_COMPANY_IDS, CONSOLIDATION_CURRENCY } = require('./constants');

const odooSyncService = createOdooSyncService({
  odooClient,
  invoiceRepository,
  paymentRepository,
  partnerRepository,
  invoiceReportRepository,
  syncStateRepository,
  transaction,
  logger,
  companyIds: [...SYNCED_COMPANY_IDS],
  consolidationCompanyIds: [...CONSOLIDATION_COMPANY_IDS],
  consolidationCurrency: CONSOLIDATION_CURRENCY,
});

const financeMetricsService = createFinanceMetricsService({
  invoiceRepository, invoiceReportRepository, paymentRepository, syncStateRepository, linkRepository,
});

// Read by the CEO Control Room's client book (same public-interface rule).
const customerLedgerService = createCustomerLedgerService({
  invoiceRepository, paymentRepository, partnerRepository, clientRepository, linkRepository,
});

const clientMappingService = createClientMappingService({
  clientRepository, partnerRepository, linkRepository, invoiceRepository, transaction, audit,
});
const clientMappingController = createClientMappingController({ clientMappingService });
const router = createFinanceRouter({ clientMappingController, authenticate });

/* Without credentials (local dev without ODOO_*), skip scheduling instead
   of logging a failed sync every 15 minutes. */
function startSchedule() {
  if (!config.odooUrl || !config.odooDb || !config.odooApiKey) {
    logger.info('Odoo sync not scheduled — ODOO_URL/ODOO_DB/ODOO_API_KEY not set.');
    return;
  }
  startOdooSyncSchedule({ odooSyncService, logger, intervalMinutes: config.odooSyncMinutes });
}

module.exports = {
  router, odooSyncService, financeMetricsService, customerLedgerService, startOdooSyncSchedule: startSchedule,
};
