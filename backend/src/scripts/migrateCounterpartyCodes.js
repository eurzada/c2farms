#!/usr/bin/env node
/**
 * Migrate existing counterparty short_code values to 3-digit format (001, 002, ...).
 * Run with: node src/scripts/migrateCounterpartyCodes.js [farmId]
 * If farmId omitted, migrates all farms.
 */
import prisma from '../config/database.js';

async function main() {
  const farmIdArg = process.argv[2];
  const farms = farmIdArg
    ? await prisma.farm.findMany({ where: { id: farmIdArg } })
    : await prisma.farm.findMany();

  if (farms.length === 0) {
    console.log('No farm(s) found.');
    process.exit(1);
  }

  for (const farm of farms) {
    const counterparties = await prisma.counterparty.findMany({
      where: { farm_id: farm.id },
      orderBy: { name: 'asc' },
    });

    let nextSeq = 1;
    for (const cp of counterparties) {
      const newCode = String(nextSeq - 1).padStart(3, '0');
      const oldCode = cp.short_code;
      if (oldCode === newCode) {
        nextSeq++;
        continue;
      }
      await prisma.counterparty.update({
        where: { id: cp.id },
        data: { short_code: newCode },
      });
      console.log(`  ${farm.name} | ${cp.name}: ${oldCode} → ${newCode}`);
      nextSeq++;
    }

    // Update next_counterparty_seq for this farm
    await prisma.marketingSettings.upsert({
      where: { farm_id: farm.id },
      update: { next_counterparty_seq: nextSeq },
      create: { farm_id: farm.id, next_counterparty_seq: nextSeq },
    });
    console.log(`  ${farm.name}: next_counterparty_seq = ${nextSeq}`);
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
