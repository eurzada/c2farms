/**
 * One-time migration: rename MarketingContract status 'settled' → 'fulfilled'.
 *
 * Usage: node backend/src/scripts/migrateSettledToFulfilled.js
 */
import prisma from '../config/database.js';

async function main() {
  const result = await prisma.marketingContract.updateMany({
    where: { status: 'settled' },
    data: { status: 'fulfilled' },
  });
  console.log(`Updated ${result.count} marketing contracts from 'settled' to 'fulfilled'.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
