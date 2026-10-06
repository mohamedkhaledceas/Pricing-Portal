/* Composition root for management/delivery — the ClickUp delivery-space
   copy (migration 044): repository -> sync service + schedule, and the
   summary service the Control Room reads through this public interface. */
const logger = require('../../../common/logger');
const { clickupGet } = require('../../../common/integrations/clickupClient');
const { CLIENT_NAME_FIELD_ID } = require('../clients/container');
const deliveryRepository = require('./repositories/deliveryRepository');
const { transaction } = require('./repositories/unitOfWork');
const createDeliverySyncService = require('./services/deliverySyncService');
const createDeliverySummaryService = require('./services/deliverySummaryService');
const { startDeliverySyncSchedule } = require('./jobs/deliverySyncSchedule');

const deliverySyncService = createDeliverySyncService({
  clickupGet, deliveryRepository, transaction, logger, clientNameFieldId: CLIENT_NAME_FIELD_ID,
});
const deliverySummaryService = createDeliverySummaryService({ deliveryRepository });

module.exports = {
  getDeliverySummary: deliverySummaryService.getDeliverySummary,
  startDeliverySyncSchedule: () => startDeliverySyncSchedule({ deliverySyncService, logger }),
};
