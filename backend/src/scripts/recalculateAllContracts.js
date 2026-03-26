/**
 * One-time script: recalculate delivered_mt, remaining_mt, and status for ALL marketing contracts.
 * Fixes stale data from settlements linked after approval or tickets imported before contracts.
 *
 * Usage: node backend/src/scripts/recalculateAllContracts.js
 */
import prisma from '../config/database.js';
import { recalculateContract } from '../services/marketingService.js';

async function main() {
  const contracts = await prisma.marketingContract.findMany({
    select: { id: true, contract_number: true, status: true, delivered_mt: true, remaining_mt: true },
  });

  console.log(`Recalculating ${contracts.length} contracts...`);

  let changed = 0;
  for (const c of contracts) {
    const result = await recalculateContract(c.id);
    if (!result) continue;

    if (result.previous_status !== result.new_status ||
        Math.abs(c.delivered_mt - result.delivered_mt) > 0.01) {
      console.log(
        `  ${c.contract_number}: ` +
        `delivered ${c.delivered_mt.toFixed(2)} → ${result.delivered_mt.toFixed(2)}, ` +
        `remaining ${c.remaining_mt.toFixed(2)} → ${result.remaining_mt.toFixed(2)}, ` +
        `status ${result.previous_status} → ${result.new_status}`
      );
      changed++;
    }
  }

  console.log(`Done. ${changed} contracts updated, ${contracts.length - changed} unchanged.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
