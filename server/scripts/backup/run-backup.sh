#!/bin/bash
#
# Daily off-site backup of the Pricing Portal SQLite database.
# Triggered by launchd on this Mac (see com.ceas.pricingportal.dbbackup.plist,
# the installed copy of which lives at
# ~/Library/LaunchAgents/com.ceas.pricingportal.dbbackup.plist).
#
# Flow: SSH to Render -> take an online backup with better-sqlite3 into /tmp
# (never the persistent disk, so backups don't eat into the paid disk quota)
# -> scp it down -> delete the remote temp copy -> verify integrity locally
# -> prune old local backups -> log the outcome -> notify on any failure.

set -euo pipefail

# --- Configuration -----------------------------------------------------
SSH_KEY="$HOME/.ssh/render_pricing_portal"
SSH_HOST="srv-d9s69vfavr4c73ai7vi0@ssh.oregon.render.com"
REMOTE_APP_DIR="/opt/render/project/src/server"   # confirmed via manual SSH check
LOCAL_BACKUP_DIR="$HOME/ceas-backups/pricing-portal"
RETENTION_DAYS=14
LOCK_DIR="/tmp/pp-backup.lock"

# --- Setup ---------------------------------------------------------------
mkdir -p "$LOCAL_BACKUP_DIR"
LOG_FILE="$LOCAL_BACKUP_DIR/backup.log"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

notify_failure() {
  local message="$1"
  log "FAILURE: $message"
  osascript -e "display notification \"$message\" with title \"Pricing Portal backup failed\"" >/dev/null 2>&1 || true
}

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "SKIP: previous backup run still in progress (lock held at $LOCK_DIR)"
  exit 0
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_TMP="/tmp/pp-backup-$TIMESTAMP.db"
LOCAL_FILE="$LOCAL_BACKUP_DIR/backup-$TIMESTAMP.db"

# --- 1. Take the snapshot on Render, into /tmp (never the persistent disk) ---
if ! ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" \
    "cd '$REMOTE_APP_DIR' && DB_DIR=/var/data node src/backup.js '$REMOTE_TMP'"; then
  notify_failure "remote snapshot step failed (SSH/backup.js)"
  exit 1
fi

# --- 2. Pull it down ---
if ! scp -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST:$REMOTE_TMP" "$LOCAL_FILE"; then
  notify_failure "scp download failed"
  exit 1
fi

# --- 3. Delete the remote temp copy (best-effort — don't fail the run over it) ---
ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "rm -f '$REMOTE_TMP'" \
  || log "WARNING: failed to delete remote temp file $REMOTE_TMP"

# --- 4. Verify integrity locally ---
INTEGRITY="$(sqlite3 "$LOCAL_FILE" "PRAGMA integrity_check;" 2>&1 || true)"
if [ "$INTEGRITY" != "ok" ]; then
  notify_failure "integrity check failed on $LOCAL_FILE: $INTEGRITY"
  exit 1
fi

SIZE=$(stat -f%z "$LOCAL_FILE" 2>/dev/null || stat -c%s "$LOCAL_FILE")
log "SUCCESS: $LOCAL_FILE ($SIZE bytes, integrity ok)"

# --- 5. Prune local backups older than the retention window ---
find "$LOCAL_BACKUP_DIR" -name 'backup-*.db' -mtime "+$RETENTION_DAYS" -delete

exit 0
