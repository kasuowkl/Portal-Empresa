#!/bin/bash
set -euo pipefail

PORTAL_DIR="/var/www/html/wkl/Portal"
BACKUP_DIR="$PORTAL_DIR/_backups/nightly"
STAMP="$(date +%F_%H%M%S)"
ARCHIVE="$BACKUP_DIR/portal_${STAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

tar \
  --exclude="$PORTAL_DIR/node_modules" \
  --exclude="$PORTAL_DIR/logs" \
  --exclude="$PORTAL_DIR/_backups" \
  --exclude="$PORTAL_DIR/.git" \
  --exclude="$PORTAL_DIR/.claude" \
  -czf "$ARCHIVE" \
  -C "$PORTAL_DIR" .

find "$BACKUP_DIR" -type f -name 'portal_*.tar.gz' -mtime +30 -delete

echo "Backup gerado: $ARCHIVE"
