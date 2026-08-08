const fs = require('fs');
const path = require('path');

const LOG_RETENTION_DAYS = 14;

/* Mirrors db.js's DB_DIR resolution so logs land on the same Render
   persistent disk as the database — anywhere else on the container
   filesystem is wiped on every deploy/restart. */
const logDir = path.join(process.env.DB_DIR || path.join(__dirname, '..', '..', 'data'), 'logs');
fs.mkdirSync(logDir, { recursive: true });

function currentLogFile() {
  const stamp = new Date().toISOString().slice(0, 10);
  return path.join(logDir, `app-${stamp}.log`);
}

function pruneOldLogs() {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let entries;
  try {
    entries = fs.readdirSync(logDir);
  } catch (error) {
    return;
  }
  entries.forEach((name) => {
    const match = /^app-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
    if (!match) return;
    const fileDate = new Date(`${match[1]}T00:00:00Z`).getTime();
    if (Number.isFinite(fileDate) && fileDate < cutoff) {
      try {
        fs.unlinkSync(path.join(logDir, name));
      } catch (error) {
        // best-effort cleanup — a failed unlink here shouldn't take the app down
      }
    }
  });
}

class Logger {
  constructor() {
    if (Logger.instance) return Logger.instance;
    Logger.instance = this;
    pruneOldLogs();
    this.pruneInterval = setInterval(pruneOldLogs, 24 * 60 * 60 * 1000);
    this.pruneInterval.unref();
  }

  log(level, message, metadata = {}) {
    const line = JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      ...metadata,
    });

    if (level === 'error' || level === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }

    try {
      fs.appendFileSync(currentLogFile(), line + '\n');
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to write log file',
        error: error.message,
        timestamp: new Date().toISOString(),
      }));
    }
  }

  info(message, metadata) { this.log('info', message, metadata); }
  warn(message, metadata) { this.log('warn', message, metadata); }
  error(message, metadata) { this.log('error', message, metadata); }
  debug(message, metadata) { this.log('debug', message, metadata); }
}

module.exports = new Logger();
