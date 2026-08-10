#!/bin/bash
#
# (Re)installs the local database backup pipeline. Run this after any change
# to run-backup.sh or com.ceas.pricingportal.dbbackup.plist.
#
# Copies run-backup.sh out to $DEPLOY_DIR — deliberately outside
# ~/Documents, since that's a macOS TCC-protected folder and a bare
# launchd-spawned /bin/bash (unlike an interactive Terminal shell) has no
# grant to read files there. The repo copy stays the reviewed source of
# truth; this script is what keeps the deployed copy in sync with it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$HOME/ceas-backups/pricing-portal/bin"
PLIST_NAME="com.ceas.pricingportal.dbbackup.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

mkdir -p "$DEPLOY_DIR"
cp "$SCRIPT_DIR/run-backup.sh" "$DEPLOY_DIR/run-backup.sh"
chmod +x "$DEPLOY_DIR/run-backup.sh"

launchctl unload "$LAUNCH_AGENTS_DIR/$PLIST_NAME" 2>/dev/null || true
cp "$SCRIPT_DIR/$PLIST_NAME" "$LAUNCH_AGENTS_DIR/$PLIST_NAME"
launchctl load "$LAUNCH_AGENTS_DIR/$PLIST_NAME"

echo "Deployed script: $DEPLOY_DIR/run-backup.sh"
echo "launchd status:"
launchctl list | grep com.ceas.pricingportal.dbbackup || echo "(not showing yet — try again in a few seconds)"
