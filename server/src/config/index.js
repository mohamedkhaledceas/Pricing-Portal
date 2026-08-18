require('dotenv').config();

/* The only file this pass reads process.env in for the pieces it touches
   (auth, the database connection). clickup.js/clickupReconcile.js/
   clickupWebhook.js/backup.js/seed-owner.js still read process.env directly
   for now — deliberately out of scope here, since centralizing those belongs
   with the Commercial Lead relocation pass that already has to touch every
   one of those files' require paths, not this one.

   Deliberately does NOT validate JWT_SECRET's presence here — index.js's
   existing startup check (logger.error + process.exit(1), a clean
   operator-facing message) stays the actual fail-fast gate. Throwing from
   here instead would make db.js (which only needs dbDir) transitively fail
   on a missing var it doesn't itself use, just because it now also requires
   this shared module — an awkward coupling for no real benefit over the
   check index.js already has. */

module.exports = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '0.0.0.0',
  dbDir: process.env.DB_DIR || null, // null lets db.js fall back to its own default path
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
});
