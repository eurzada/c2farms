#!/bin/bash
# Import local agronomy/procurement data into Render (additive — no deletes)
# These are all INSERT-only into empty or non-overlapping tables.
#
# Usage: ./scripts/render-imports/import-to-render.sh

set -e

RENDER_DB="postgresql://c2farms:Eegwjhwd9ovZWPNo3fgHnjVVZ4ba7fxO@dpg-d6hkovh5pdvs73djrm60-a.oregon-postgres.render.com/c2farms"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Importing to Render ==="
echo ""

# 1. Counterparties (Nutrien Ag, UFA) — needed by procurement_contracts FK
echo "1. Counterparties (Nutrien Ag, UFA)..."
psql "$RENDER_DB" -c "\copy counterparties FROM '${DIR}/counterparties_nutrien_ufa.csv' WITH CSV HEADER"

# 2. Agro Products (53 Synergy/Nutrien products — won't conflict with Tyson's 41)
echo "2. Agro Products (Synergy/Nutrien dealer products)..."
psql "$RENDER_DB" -c "\copy agro_products FROM '${DIR}/agro_products_synergy_nutrien.csv' WITH CSV HEADER"

# 3. Work Order Lines (189 CWO lines — table is empty on Render)
echo "3. Work Order Lines (Synergy/Nutrien CWOs)..."
psql "$RENDER_DB" -c "\copy work_order_lines FROM '${DIR}/work_order_lines.csv' WITH CSV HEADER"

# 4. Procurement Contracts (15 contracts — table is empty on Render)
echo "4. Procurement Contracts (Nutrien fertilizer + UFA fuel)..."
psql "$RENDER_DB" -c "\copy procurement_contracts FROM '${DIR}/procurement_contracts.csv' WITH CSV HEADER"

# 5. Procurement Contract Lines (38 lines — table is empty on Render)
echo "5. Procurement Contract Lines..."
psql "$RENDER_DB" -c "\copy procurement_contract_lines FROM '${DIR}/procurement_contract_lines.csv' WITH CSV HEADER"

echo ""
echo "=== Done! Verify counts ==="
psql "$RENDER_DB" -c "
SELECT 'counterparties' as table_name, count(*) FROM counterparties
UNION ALL SELECT 'agro_products', count(*) FROM agro_products
UNION ALL SELECT 'work_order_lines', count(*) FROM work_order_lines
UNION ALL SELECT 'procurement_contracts', count(*) FROM procurement_contracts
UNION ALL SELECT 'procurement_contract_lines', count(*) FROM procurement_contract_lines
"
