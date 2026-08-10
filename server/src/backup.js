/* Remote side of the daily database backup (see scripts/backup/run-backup.sh).
   Run manually on the host that owns the live app.db, e.g. over the Render
   SSH session:

     DB_DIR=/var/data node src/backup.js /tmp/pp-backup-<timestamp>.db

   Uses better-sqlite3's online backup API (safe under WAL mode, unlike a
   raw file copy) instead of requiring db.js, so this never runs the
   schema-creation/migration statements that module also carries. */
const path = require('path');
const Database = require('better-sqlite3');

const destPath = process.argv[2];
if (!destPath) {
  console.error('Usage: node backup.js <destination-path>');
  process.exit(1);
}

const dbDir = process.env.DB_DIR || path.join(__dirname, '..', 'data');
const dbPath = path.join(dbDir, 'app.db');

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

db.backup(destPath)
  .then(() => {
    db.close();
  })
  .catch((err) => {
    db.close();
    console.error(`Backup failed: ${err.message}`);
    process.exit(1);
  });
