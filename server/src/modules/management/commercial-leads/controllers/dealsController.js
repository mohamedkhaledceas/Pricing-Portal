const { ValidationError } = require('../../../../common/errors');
const { getWorkspaceSurvey } = require('../../../../common/integrations/clickupClient');

/* Same validation behavior as index.js's numOrDefault (used extensively by
   the still-legacy Pricing routes there) — a small local copy rather than
   this module depending on that file, since a module should never depend
   on the legacy monolith it's being extracted out of. */
function numOrDefault(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`"${fieldName}" must be a valid number.`);
  }
  return n;
}

function createDealsController({ dealsService }) {
  /* Exploratory: structural map of the connected ClickUp workspace (spaces,
     folders, lists). Not commercial-lead-specific data, but the only
     current caller, kept here rather than adding a controller of its own
     for one diagnostic route. */
  async function clickupSurvey(req, res, next) {
    try {
      const teams = await getWorkspaceSurvey();
      res.json({ teams });
    } catch (error) {
      next(error);
    }
  }

  /* Reads only from our own DB — never a live ClickUp call. That data is
     kept fresh by clickupSyncService (webhooks) and the reconcile job
     (periodic safety net), independent of any request hitting these routes. */
  function deals(req, res) {
    res.json({ deals: dealsService.getDeals() });
  }

  function stats(req, res) {
    const days = numOrDefault(req.query.days, 30, 'days');
    res.json({ stats: dealsService.getDailyStats(days) });
  }

  function stageDurations(req, res) {
    res.json({ stageDurations: dealsService.getStageDurations() });
  }

  function statusColors(req, res) {
    res.json({ statusColors: dealsService.getStatusColors() });
  }

  /* Cohort-performance quarterly KPIs (docs/adr/0010-commercial-lead-quarterly-kpis.md)
     — always live. An unrecognized/omitted ?quarter falls back to the
     current quarter inside getQuarterlyKpis rather than erroring. */
  function quarterlyKpis(req, res) {
    res.json(dealsService.getQuarterlyKpis(req.query.quarter));
  }

  // exportDealsCsv itself throws ValidationError for an unrecognized `list`
  // — no need to duplicate that check here, Express forwards a sync throw
  // to errorHandler.js the same way every other route in this file already
  // relies on (see `deals` above).
  function exportDeals(req, res) {
    const listKey = req.query.list;
    const csv = dealsService.exportDealsCsv(listKey);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${listKey}-deals-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  }

  return { clickupSurvey, deals, stats, stageDurations, statusColors, quarterlyKpis, exportDeals };
}

module.exports = createDealsController;
