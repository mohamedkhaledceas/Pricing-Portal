/* HTTP translation for the client-mapping review — see
   clientMappingService.js. Explicit try/catch -> next(err), same as
   employees' departmentController. */
function createClientMappingController({ clientMappingService }) {
  const actorOf = (req) => ({ id: req.user.id, role: req.user.role });

  function overview(req, res, next) {
    try {
      return res.json({ clientMapping: clientMappingService.getOverview(actorOf(req)) });
    } catch (err) {
      return next(err);
    }
  }

  function link(req, res, next) {
    try {
      const { clientId, odooPartnerId } = req.body || {};
      return res.json({ link: clientMappingService.link({ actor: actorOf(req), clientId, odooPartnerId, ip: req.ip }) });
    } catch (err) {
      return next(err);
    }
  }

  function reject(req, res, next) {
    try {
      const { clientId, odooPartnerId } = req.body || {};
      return res.json({ link: clientMappingService.reject({ actor: actorOf(req), clientId, odooPartnerId, ip: req.ip }) });
    } catch (err) {
      return next(err);
    }
  }

  function createClient(req, res, next) {
    try {
      const { odooPartnerId } = req.body || {};
      const result = clientMappingService.createClientFromPartner({ actor: actorOf(req), odooPartnerId, ip: req.ip });
      return res.status(201).json(result);
    } catch (err) {
      return next(err);
    }
  }

  return { overview, link, reject, createClient };
}

module.exports = createClientMappingController;
