/* password_reset_tokens — same shape as the base schema's refresh_tokens
   table (db.js), just single-use and short-lived instead of rotating: a raw
   token is emailed to the user, only its sha256 hash is ever persisted
   (see repositories/passwordResetTokenRepository.js), and used_at (rather
   than deletion) records that a token was consumed, so a reused/expired
   link fails the same lookup a completely unknown one would. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
  `);
}

module.exports = { up };
