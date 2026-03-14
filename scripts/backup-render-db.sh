#!/bin/bash
# Backup Render PostgreSQL database to local file
# Usage: ./scripts/backup-render-db.sh [--dir /path/to/backups]
#
# Creates timestamped backups in ~/c2farms-backups/ by default.
# Run this BEFORE every deploy to protect production data.
#
# Uses psql \copy for each table (avoids pg_dump version mismatch).

set -e

RENDER_DB="postgresql://c2farms:Eegwjhwd9ovZWPNo3fgHnjVVZ4ba7fxO@dpg-d6hkovh5pdvs73djrm60-a.oregon-postgres.render.com/c2farms"
BACKUP_DIR="${HOME}/c2farms-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir) BACKUP_DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

BACKUP_FOLDER="${BACKUP_DIR}/${TIMESTAMP}"
mkdir -p "$BACKUP_FOLDER"

echo "=== Backing up Render database ==="
echo "Timestamp: ${TIMESTAMP}"
echo "Target: ${BACKUP_FOLDER}"
echo ""

# Get schema DDL (structure only — works via psql regardless of version)
echo "Dumping schema..."
psql "$RENDER_DB" -c "\dt" > "${BACKUP_FOLDER}/_tables.txt" 2>/dev/null
psql "$RENDER_DB" -c "
  SELECT 'CREATE TABLE ' || tablename || ' (...);\n'
  FROM pg_tables WHERE schemaname = 'public';
" > /dev/null 2>&1

# Dump each table as CSV using psql \copy (no pg_dump version issues)
TABLES=$(psql "$RENDER_DB" -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename" 2>/dev/null)

TOTAL=0
for table in $TABLES; do
  FILE="${BACKUP_FOLDER}/${table}.csv"
  COUNT=$(psql "$RENDER_DB" -t -A -c "SELECT count(*) FROM \"${table}\"" 2>/dev/null)
  psql "$RENDER_DB" -c "\copy \"${table}\" TO STDOUT WITH CSV HEADER" > "$FILE" 2>/dev/null
  SIZE=$(du -h "$FILE" | cut -f1)
  printf "  %-40s %6s rows  %s\n" "$table" "$COUNT" "$SIZE"
  TOTAL=$((TOTAL + COUNT))
done

# Also dump full SQL schema via pg_dump --schema-only (still works cross-version for DDL)
echo ""
echo "Dumping schema DDL..."
SCHEMA_FILE="${BACKUP_FOLDER}/_schema.sql"
psql "$RENDER_DB" -c "
  SELECT pg_catalog.pg_get_functiondef(p.oid)
  FROM pg_catalog.pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
" > /dev/null 2>&1 || true

# Use information_schema to rebuild CREATE TABLE statements
psql "$RENDER_DB" <<'EOSQL' > "$SCHEMA_FILE" 2>/dev/null
SELECT
  'CREATE TABLE "' || table_name || '" (' ||
  string_agg(
    '"' || column_name || '" ' || data_type ||
    CASE WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')' ELSE '' END ||
    CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
    CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
    ', '
    ORDER BY ordinal_position
  ) || ');'
FROM information_schema.columns
WHERE table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;
EOSQL
echo "  → Schema saved to _schema.sql"

# Create a compressed archive
echo ""
echo "Compressing..."
ARCHIVE="${BACKUP_DIR}/c2farms_render_${TIMESTAMP}.tar.gz"
tar -czf "$ARCHIVE" -C "$BACKUP_DIR" "$TIMESTAMP"
ARCHIVE_SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo "  → ${ARCHIVE} (${ARCHIVE_SIZE})"

# Summary
echo ""
echo "=== Backup complete ==="
echo "Total rows: ${TOTAL}"
echo "Tables: $(echo "$TABLES" | wc -w)"
echo "Archive: ${ARCHIVE}"
echo ""
echo "To restore a table:"
echo "  psql \"\$RENDER_DB\" -c \"\\copy \\\"table_name\\\" FROM '${BACKUP_FOLDER}/table_name.csv' WITH CSV HEADER\""

# Cleanup old backups (keep last 10 archives)
ARCHIVE_COUNT=$(ls -1 "${BACKUP_DIR}"/c2farms_render_*.tar.gz 2>/dev/null | wc -l)
if [ "$ARCHIVE_COUNT" -gt 10 ]; then
  echo ""
  echo "Cleaning old backups (keeping last 10)..."
  ls -1t "${BACKUP_DIR}"/c2farms_render_*.tar.gz | tail -n +11 | while read f; do
    rm -f "$f"
    # Also remove the uncompressed folder
    FOLDER="${f%.tar.gz}"
    FOLDER="${BACKUP_DIR}/$(basename "$FOLDER" | sed 's/c2farms_render_//')"
    rm -rf "$FOLDER"
  done
fi
