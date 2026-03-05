#!/usr/bin/env node
/**
 * Clear all Inventory and Marketing module data.
 * Leaves forecast, users, farms, categories, and GL data intact.
 *
 * Usage:  node backend/src/scripts/clearInventoryMarketing.js
 * Re-seed: node backend/src/scripts/seedInventory.js
 *          node backend/src/scripts/seedMarketing.js
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('=== Clearing Inventory & Marketing data ===\n');

  // Order matters — delete child tables first to respect FK constraints.

  // 1. Marketing children
  const cashFlow = await prisma.cashFlowEntry.deleteMany({});
  console.log(`  CashFlowEntry:       ${cashFlow.count} deleted`);

  const priceAlerts = await prisma.priceAlert.deleteMany({});
  console.log(`  PriceAlert:          ${priceAlerts.count} deleted`);

  const marketPrices = await prisma.marketPrice.deleteMany({});
  console.log(`  MarketPrice:         ${marketPrices.count} deleted`);

  // 2. Deliveries (shared by both modules)
  const deliveries = await prisma.delivery.deleteMany({});
  console.log(`  Delivery:            ${deliveries.count} deleted`);

  // 3. Marketing contracts & counterparties
  const mktContracts = await prisma.marketingContract.deleteMany({});
  console.log(`  MarketingContract:   ${mktContracts.count} deleted`);

  const counterparties = await prisma.counterparty.deleteMany({});
  console.log(`  Counterparty:        ${counterparties.count} deleted`);

  const mktSettings = await prisma.marketingSettings.deleteMany({});
  console.log(`  MarketingSettings:   ${mktSettings.count} deleted`);

  // 4. Inventory children
  const binCounts = await prisma.binCount.deleteMany({});
  console.log(`  BinCount:            ${binCounts.count} deleted`);

  const submissions = await prisma.countSubmission.deleteMany({});
  console.log(`  CountSubmission:     ${submissions.count} deleted`);

  const periods = await prisma.countPeriod.deleteMany({});
  console.log(`  CountPeriod:         ${periods.count} deleted`);

  const contracts = await prisma.contract.deleteMany({});
  console.log(`  Contract:            ${contracts.count} deleted`);

  // 5. Bins & locations
  const bins = await prisma.inventoryBin.deleteMany({});
  console.log(`  InventoryBin:        ${bins.count} deleted`);

  const locations = await prisma.inventoryLocation.deleteMany({});
  console.log(`  InventoryLocation:   ${locations.count} deleted`);

  // 6. Commodities (shared — referenced by both modules, so cleared last)
  const commodities = await prisma.commodity.deleteMany({});
  console.log(`  Commodity:           ${commodities.count} deleted`);

  console.log('\n✓ Done. Inventory & Marketing modules are empty.');
  console.log('  To re-seed later:');
  console.log('    node backend/src/scripts/seedInventory.js');
  console.log('    node backend/src/scripts/seedMarketing.js');
}

main()
  .catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
