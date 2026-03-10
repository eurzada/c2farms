#!/bin/bash
# C2 Farms — Automated DB backup to Google Drive
# Dumps local PostgreSQL, uploads to gdrive:C2Farms-Backups, cleans up old local files

set -euo pipefail

DB_URL="postgresql://c2farms:c2farms_dev@localhost:5432/c2farms"
BACKUP_DIR="/home/aristotle/c2farms/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="c2farms_${TIMESTAMP}.sql.gz"
KEEP_LOCAL=7  # days to keep local backups

echo "[$(date)] Starting C2 Farms backup..."

# Dump and compress
pg_dump "$DB_URL" | gzip > "${BACKUP_DIR}/${FILENAME}"
echo "[$(date)] Dump complete: ${FILENAME} ($(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1))"

# Upload to Google Drive
rclone copy "${BACKUP_DIR}/${FILENAME}" gdrive:C2Farms-Backups/
echo "[$(date)] Uploaded to Google Drive: C2Farms-Backups/${FILENAME}"

# Clean up local backups older than $KEEP_LOCAL days
find "$BACKUP_DIR" -name "c2farms_*.sql.gz" -mtime +${KEEP_LOCAL} -delete
echo "[$(date)] Cleanup complete. Backup finished."
