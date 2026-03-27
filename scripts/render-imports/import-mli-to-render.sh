#!/bin/bash
# Import local-only MLI data into Render (additive — no deletes)
# - 1 counterparty (Bunge Canada Inc.)
# - 11 marketing contracts
# - 228 elevator tickets
#
# Usage: ./scripts/render-imports/import-mli-to-render.sh

set -e

RENDER_DB="postgresql://c2farms:Eegwjhwd9ovZWPNo3fgHnjVVZ4ba7fxO@dpg-d6hkovh5pdvs73djrm60-a.oregon-postgres.render.com/c2farms"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Importing MLI data to Render ==="
echo ""

# 1. Counterparty (Bunge Canada Inc. — needed by marketing_contracts FK)
echo "1. Counterparty (Bunge Canada Inc.)..."
psql "$RENDER_DB" -c "\copy counterparties FROM '${DIR}/counterparty_bunge_inc.csv' WITH CSV HEADER"

# 2. Marketing Contracts (11 local-only contracts)
echo "2. Marketing Contracts (11 contracts — Bunge, Cargill, Ceres, LGX)..."
psql "$RENDER_DB" -c "\copy marketing_contracts FROM '${DIR}/marketing_contracts_local_only.csv' WITH CSV HEADER"

# 3. Elevator Tickets (228 — table is empty on Render)
echo "3. Elevator Tickets (228 Feb 2026 tickets)..."
psql "$RENDER_DB" -c "\copy elevator_tickets FROM '${DIR}/elevator_tickets.csv' WITH CSV HEADER"

echo ""
echo "=== Done! Verify counts ==="
psql "$RENDER_DB" -c "
SELECT 'counterparties' as table_name, count(*) FROM counterparties
UNION ALL SELECT 'marketing_contracts', count(*) FROM marketing_contracts
UNION ALL SELECT 'elevator_tickets', count(*) FROM elevator_tickets
"
