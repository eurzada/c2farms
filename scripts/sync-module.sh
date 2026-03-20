#!/bin/bash
# Module-level selective database sync between local and Render
# Usage: ./scripts/sync-module.sh <push|pull> <module> [module...] [--dry-run] [--no-backup] [--yes]
#
# Modules: core, forecast, agronomy, procurement, mli, terminal
#
# Examples:
#   ./scripts/sync-module.sh push agronomy procurement   # local → Render
#   ./scripts/sync-module.sh pull mli                     # Render → local
#   ./scripts/sync-module.sh push forecast --dry-run      # preview only

set -e

LOCAL_DB="postgresql://c2farms:c2farms_dev@localhost:5432/c2farms"
RENDER_DB="postgresql://c2farms:Eegwjhwd9ovZWPNo3fgHnjVVZ4ba7fxO@dpg-d6hkovh5pdvs73djrm60-a.oregon-postgres.render.com/c2farms"
BACKUP_BASE="${HOME}/c2farms-backups/module-sync"
TMP_DIR="/tmp/c2farms-sync-$$"

# --- Module → table mappings (insertion order: parents first) ---

CORE_TABLES=(
  users farms user_farm_roles farm_invites
  ai_conversations ai_messages audit_logs
  fieldops_tokens qb_tokens
)

FORECAST_TABLES=(
  financial_categories assumptions farm_categories
  gl_accounts gl_actual_details monthly_data
  monthly_data_frozen operational_data qb_category_mappings
)

AGRONOMY_TABLES=(
  agro_plans crop_allocations crop_inputs season_profiles
  agro_products work_order_lines cwo_import_snapshots
  cwo_field_group_mappings labour_plans labour_seasons labour_roles
)

PROCUREMENT_TABLES=(
  procurement_contracts procurement_contract_lines
)

MLI_TABLES=(
  commodities commodity_aliases inventory_locations inventory_bins
  bin_grades count_periods count_submissions bin_counts
  inventory_withdrawals counterparties counterparty_aliases
  marketing_contracts market_prices price_alerts cash_flow_entries
  marketing_settings contracts deliveries delivery_tickets
  ai_batches settlements settlement_lines settlement_format_hints
  elevator_tickets
)

TERMINAL_TABLES=(
  terminal_bins terminal_tickets terminal_samples
  terminal_blend_events terminal_contracts terminal_settlements
  terminal_settlement_lines daily_positions
)

# --- Helpers ---

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

get_tables_for_module() {
  local module="$1"
  case "$module" in
    core)        echo "${CORE_TABLES[@]}" ;;
    forecast)    echo "${FORECAST_TABLES[@]}" ;;
    agronomy)    echo "${AGRONOMY_TABLES[@]}" ;;
    procurement) echo "${PROCUREMENT_TABLES[@]}" ;;
    mli)         echo "${MLI_TABLES[@]}" ;;
    terminal)    echo "${TERMINAL_TABLES[@]}" ;;
    *) echo "ERROR: Unknown module: $module" >&2; exit 1 ;;
  esac
}

get_row_count() {
  local db="$1" table="$2"
  psql "$db" -t -A -c "SELECT count(*) FROM \"${table}\"" 2>/dev/null || echo "0"
}

# --- Parse arguments ---

DIRECTION=""
MODULES=()
DRY_RUN=false
NO_BACKUP=false
AUTO_YES=false

while [[ $# -gt 0 ]]; do
  case $1 in
    push|pull)
      DIRECTION="$1"; shift ;;
    --dry-run)
      DRY_RUN=true; shift ;;
    --no-backup)
      NO_BACKUP=true; shift ;;
    --yes|-y)
      AUTO_YES=true; shift ;;
    -*)
      echo -e "${RED}Unknown flag: $1${NC}"; exit 1 ;;
    *)
      MODULES+=("$1"); shift ;;
  esac
done

if [ -z "$DIRECTION" ] || [ ${#MODULES[@]} -eq 0 ]; then
  echo "Usage: ./scripts/sync-module.sh <push|pull> <module> [module...] [--dry-run] [--no-backup] [--yes]"
  echo ""
  echo "Modules: core, forecast, agronomy, procurement, mli, terminal"
  echo ""
  echo "  push   local → Render"
  echo "  pull   Render → local"
  echo ""
  echo "Flags:"
  echo "  --dry-run    Show row counts only, no data changes"
  echo "  --no-backup  Skip backing up target tables before overwrite"
  echo "  --yes, -y    Skip confirmation prompt"
  exit 1
fi

# Set source/target based on direction
if [ "$DIRECTION" = "push" ]; then
  SOURCE_DB="$LOCAL_DB"
  TARGET_DB="$RENDER_DB"
  SOURCE_LABEL="Local"
  TARGET_LABEL="Render"
else
  SOURCE_DB="$RENDER_DB"
  TARGET_DB="$LOCAL_DB"
  SOURCE_LABEL="Render"
  TARGET_LABEL="Local"
fi

# --- Collect all tables (deduplicated, in order) ---

ALL_TABLES=()
declare -A SEEN_TABLES

for module in "${MODULES[@]}"; do
  tables=$(get_tables_for_module "$module")
  for t in $tables; do
    if [ -z "${SEEN_TABLES[$t]:-}" ]; then
      ALL_TABLES+=("$t")
      SEEN_TABLES[$t]=1
    fi
  done
done

# --- Cross-module dependency warnings ---

declare -A MODULE_SET
for m in "${MODULES[@]}"; do MODULE_SET[$m]=1; done

echo ""
HAS_WARNINGS=false
if [ -n "${MODULE_SET[procurement]:-}" ] && [ -z "${MODULE_SET[mli]:-}" ]; then
  echo -e "${YELLOW}⚠ Warning: syncing 'procurement' without 'mli' — procurement_contracts references counterparties${NC}"
  HAS_WARNINGS=true
fi
if [ -n "${MODULE_SET[terminal]:-}" ] && [ -z "${MODULE_SET[mli]:-}" ]; then
  echo -e "${YELLOW}⚠ Warning: syncing 'terminal' without 'mli' — terminal tables reference commodities, counterparties${NC}"
  HAS_WARNINGS=true
fi
for m in "${MODULES[@]}"; do
  if [ "$m" != "core" ] && [ -z "${MODULE_SET[core]:-}" ]; then
    echo -e "${YELLOW}⚠ Warning: syncing without 'core' — tables reference farms, users${NC}"
    HAS_WARNINGS=true
    break
  fi
done

# --- Preview: show row counts ---

echo ""
echo -e "${BOLD}=== Module Sync Preview ===${NC}"
echo -e "Direction: ${CYAN}${DIRECTION}${NC} (${SOURCE_LABEL} → ${TARGET_LABEL})"
echo -e "Modules:   ${CYAN}${MODULES[*]}${NC}"
echo -e "Tables:    ${#ALL_TABLES[@]}"
echo ""

printf "  ${BOLD}%-40s %10s %10s${NC}\n" "Table" "$SOURCE_LABEL" "$TARGET_LABEL"
printf "  %-40s %10s %10s\n" "$(printf '%0.s─' {1..40})" "──────────" "──────────"

TOTAL_SOURCE=0
TOTAL_TARGET=0

for table in "${ALL_TABLES[@]}"; do
  src_count=$(get_row_count "$SOURCE_DB" "$table")
  tgt_count=$(get_row_count "$TARGET_DB" "$table")
  TOTAL_SOURCE=$((TOTAL_SOURCE + src_count))
  TOTAL_TARGET=$((TOTAL_TARGET + tgt_count))

  if [ "$src_count" != "$tgt_count" ]; then
    printf "  %-40s ${YELLOW}%10s${NC} %10s\n" "$table" "$src_count" "$tgt_count"
  else
    printf "  %-40s %10s %10s\n" "$table" "$src_count" "$tgt_count"
  fi
done

printf "  %-40s %10s %10s\n" "$(printf '%0.s─' {1..40})" "──────────" "──────────"
printf "  ${BOLD}%-40s %10s %10s${NC}\n" "Total" "$TOTAL_SOURCE" "$TOTAL_TARGET"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo -e "${CYAN}Dry run complete. No data was changed.${NC}"
  exit 0
fi

# --- Confirmation ---

if [ "$AUTO_YES" != true ]; then
  echo ""
  echo -e "${BOLD}This will DELETE ${TOTAL_TARGET} rows on ${TARGET_LABEL} and replace with ${TOTAL_SOURCE} rows from ${SOURCE_LABEL}.${NC}"
  read -p "Continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

mkdir -p "$TMP_DIR"

# --- Backup target tables ---

if [ "$NO_BACKUP" != true ]; then
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  BACKUP_DIR="${BACKUP_BASE}/${TIMESTAMP}"
  mkdir -p "$BACKUP_DIR"

  echo ""
  echo -e "${BOLD}=== Backing up ${TARGET_LABEL} tables ===${NC}"
  echo "  → ${BACKUP_DIR}"

  for table in "${ALL_TABLES[@]}"; do
    psql "$TARGET_DB" -c "\copy \"${table}\" TO STDOUT WITH CSV HEADER" > "${BACKUP_DIR}/${table}.csv" 2>/dev/null
    count=$(wc -l < "${BACKUP_DIR}/${table}.csv")
    count=$((count > 0 ? count - 1 : 0))  # subtract header
    printf "  %-40s %6s rows\n" "$table" "$count"
  done

  # Save metadata
  echo "direction=${DIRECTION}" > "${BACKUP_DIR}/_metadata.txt"
  echo "modules=${MODULES[*]}" >> "${BACKUP_DIR}/_metadata.txt"
  echo "timestamp=${TIMESTAMP}" >> "${BACKUP_DIR}/_metadata.txt"
  echo "target=${TARGET_LABEL}" >> "${BACKUP_DIR}/_metadata.txt"

  echo -e "${GREEN}  Backup complete${NC}"
fi

# --- Export from source ---

echo ""
echo -e "${BOLD}=== Exporting from ${SOURCE_LABEL} ===${NC}"

for table in "${ALL_TABLES[@]}"; do
  psql "$SOURCE_DB" -c "\copy \"${table}\" TO STDOUT WITH CSV HEADER" > "${TMP_DIR}/${table}.csv" 2>/dev/null
  count=$(wc -l < "${TMP_DIR}/${table}.csv")
  count=$((count > 0 ? count - 1 : 0))
  printf "  %-40s %6s rows\n" "$table" "$count"
done

# --- Import to target ---

echo ""
echo -e "${BOLD}=== Importing to ${TARGET_LABEL} ===${NC}"

# Build the SQL script:
# 1. Disable FK triggers
# 2. DELETE in reverse order (children first)
# 3. COPY in forward order (parents first)
# 4. Re-enable FK triggers

SQL_FILE="${TMP_DIR}/_import.sql"

echo "SET session_replication_role = replica;" > "$SQL_FILE"

# Deletes in reverse order
REVERSED=()
for ((i=${#ALL_TABLES[@]}-1; i>=0; i--)); do
  REVERSED+=("${ALL_TABLES[$i]}")
done

for table in "${REVERSED[@]}"; do
  echo "DELETE FROM \"${table}\";" >> "$SQL_FILE"
done

echo "SET session_replication_role = DEFAULT;" >> "$SQL_FILE"

# Run deletes
psql "$TARGET_DB" -f "$SQL_FILE" 2>/dev/null
echo "  Cleared ${#ALL_TABLES[@]} tables"

# Copy data in forward order (use \copy which is a psql meta-command)
COPY_SCRIPT="${TMP_DIR}/_copy.psql"
echo "SET session_replication_role = replica;" > "$COPY_SCRIPT"
for table in "${ALL_TABLES[@]}"; do
  echo "\\copy \"${table}\" FROM '${TMP_DIR}/${table}.csv' WITH CSV HEADER" >> "$COPY_SCRIPT"
done
echo "SET session_replication_role = DEFAULT;" >> "$COPY_SCRIPT"

psql "$TARGET_DB" -f "$COPY_SCRIPT" 2>/dev/null
echo "  Loaded ${#ALL_TABLES[@]} tables"

# --- Verify ---

echo ""
echo -e "${BOLD}=== Verification ===${NC}"

MISMATCHES=0
for table in "${ALL_TABLES[@]}"; do
  src_count=$(get_row_count "$SOURCE_DB" "$table")
  tgt_count=$(get_row_count "$TARGET_DB" "$table")

  if [ "$src_count" = "$tgt_count" ]; then
    printf "  %-40s ${GREEN}✓${NC} %s rows\n" "$table" "$tgt_count"
  else
    printf "  %-40s ${RED}✗${NC} source=%s target=%s\n" "$table" "$src_count" "$tgt_count"
    MISMATCHES=$((MISMATCHES + 1))
  fi
done

# --- Summary ---

echo ""
if [ $MISMATCHES -eq 0 ]; then
  echo -e "${GREEN}${BOLD}=== Sync complete — all tables match ===${NC}"
else
  echo -e "${RED}${BOLD}=== Sync complete — ${MISMATCHES} table(s) have mismatched counts ===${NC}"
fi

echo -e "Direction: ${DIRECTION} (${SOURCE_LABEL} → ${TARGET_LABEL})"
echo -e "Modules:   ${MODULES[*]}"
if [ "$NO_BACKUP" != true ]; then
  echo -e "Backup:    ${BACKUP_DIR}"
fi
echo ""
