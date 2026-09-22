function createSettingsController({ settingsService }) {
  function get(req, res, next) {
    try {
      return res.json({ settings: settingsService.get() });
    } catch (err) {
      return next(err);
    }
  }

  function update(req, res, next) {
    try {
      const settings = settingsService.update({ patch: req.body || {}, actorId: req.user.id, actorEmail: req.user.email, ip: req.ip });
      return res.json({ settings });
    } catch (err) {
      return next(err);
    }
  }

  return { get, update };
}

module.exports = createSettingsController;
