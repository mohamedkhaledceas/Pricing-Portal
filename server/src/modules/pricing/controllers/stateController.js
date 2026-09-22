function createStateController({ stateService }) {
  function get(req, res, next) {
    try {
      return res.json(stateService.getFullState());
    } catch (err) {
      return next(err);
    }
  }

  // Full-state overwrites are disabled to prevent concurrent-user data loss
  // — same as the legacy route. Every write goes through a granular
  // resource endpoint instead.
  function disabled(req, res) {
    return res.status(405).json({
      error: 'Use granular resource endpoints instead of PUT /api/state. Full-state overwrites are disabled to prevent concurrent-user data loss.',
    });
  }

  return { get, disabled };
}

module.exports = createStateController;
