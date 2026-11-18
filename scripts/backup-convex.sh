#!/usr/bin/env bash
# Scheduled Convex export → local snapshot.
#
# The public ledger is the product's proof surface; losing it is
# unrecoverable reputationally. Run this on a schedule (cron / GitHub
# Actions scheduled workflow) and push the snapshot to durable storage.
#
# Usage:
#   CONVEX_DEPLOY_KEY=<key> ./scripts/backup-convex.sh [output-dir]
#
# Requires: npx convex (installed via packages/backend), curl.
set -euo pipefail

OUT_DIR="${2:-./backups}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DEPLOYMENT="${CONVEX_DEPLOYMENT:-}"
mkdir -p "$OUT_DIR"

if [ -z "$DEPLOY_KEY" ] && [ -z "${CONVEX_DEPLOY_KEY:-}" ]; then
  echo "Error: set CONVEX_DEPLOY_KEY (Convex dashboard → Settings → Deploy keys)" >&2
  exit 1
fi

echo "Exporting deployment ${DEPLOYMENT:-<default>} → $OUT_DIR/snapshot-$STAMP.zip"
cd packages/backend
npx convex export --output-file "../../$OUT_DIR/snapshot-$STAMP.zip" ${DEPLOYMENT:+--deployment "$DEPLOYMENT"}

# Basic retention: keep the last 30 snapshots.
ls -1t "$OUT_DIR"/snapshot-*.zip 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true

echo "Done: $OUT_DIR/snapshot-$STAMP.zip"
echo "Reminder: copy snapshots to durable storage (S3/GCS) — this machine is not a backup."
