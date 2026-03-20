#!/usr/bin/env node
/**
 * FY2026 Budget Seeder
 *
 * Generates placeholder budget entries for Apr–Oct 2026 (future months)
 * based on FY2025 actuals for the same months. Nov 2025–Mar 2026 already
 * have QBO actuals imported.
 *
 * For each BU:
 *   1. Reads FY2025 accounting actuals (Apr–Oct)
 *   2. Copies values as FY2026 budget (is_actual=false)
 *   3. Computes per-unit layer (÷ total_acres)
 *   4. Recalculates parent sums
 *
 * Usage:
 *   node src/scripts/seedBudget2026.js [--dry-run] [--force]
 */

import { PrismaClient } from '@prisma/client';
import { recalcParentSums } from '../services/categoryService.js';
import { CALENDAR_MONTHS } from '../utils/fiscalYear.js';

const prisma = new PrismaClient();

// FY2026 future months (Apr 2026 – Oct 2026)
// Nov 2025 – Mar 2026 already have QBO actuals
const BUDGET_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  // Get all non-enterprise farms
  const farms = await prisma.farm.findMany({
    where: { is_enterprise: false },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  console.log(`Found ${farms.length} BUs\n`);

  for (const farm of farms) {
    console.log(`=== ${farm.name} ===`);

    // Get FY2026 assumption for acres
    const assumption2026 = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farm.id, fiscal_year: 2026 } },
    });
    if (!assumption2026) {
      console.log(`  ⚠ No FY2026 assumption — skipping\n`);
      continue;
    }
    const acres = assumption2026.total_acres;
    console.log(`  Acres: ${acres.toLocaleString()}`);

    // Get farm categories for parent sum recalculation
    const farmCategories = await prisma.farmCategory.findMany({
      where: { farm_id: farm.id },
    });

    // Read FY2025 accounting actuals for the budget months
    const fy2025Data = await prisma.monthlyData.findMany({
      where: {
        farm_id: farm.id,
        fiscal_year: 2025,
        type: 'accounting',
        month: { in: BUDGET_MONTHS },
      },
    });

    const fy2025ByMonth = {};
    for (const md of fy2025Data) {
      fy2025ByMonth[md.month] = md.data_json;
    }

    // Fallback: FY2024 for months missing from FY2025
    const fy2024Data = await prisma.monthlyData.findMany({
      where: {
        farm_id: farm.id,
        fiscal_year: 2024,
        type: 'accounting',
        month: { in: BUDGET_MONTHS },
      },
    });
    const fy2024ByMonth = {};
    for (const md of fy2024Data) {
      fy2024ByMonth[md.month] = md.data_json;
    }

    // Check which FY2026 months already have actuals (don't overwrite)
    const existing2026 = await prisma.monthlyData.findMany({
      where: {
        farm_id: farm.id,
        fiscal_year: 2026,
        type: 'accounting',
        month: { in: BUDGET_MONTHS },
        is_actual: true,
      },
    });
    const actualMonths = new Set(existing2026.map(m => m.month));

    let created = 0;
    let skipped = 0;

    for (const month of BUDGET_MONTHS) {
      if (actualMonths.has(month)) {
        console.log(`  ${month}: has actuals — skipping`);
        skipped++;
        continue;
      }

      // Use FY2025 same month, fallback to FY2024
      const sourceAccounting = fy2025ByMonth[month] || fy2024ByMonth[month];
      if (!sourceAccounting) {
        console.log(`  ${month}: no FY2025/2024 source data — skipping`);
        skipped++;
        continue;
      }

      // Build per-unit by dividing accounting by FY2026 acres
      const perUnitData = {};
      const accountingData = {};
      for (const [code, val] of Object.entries(sourceAccounting)) {
        if (typeof val !== 'number') continue;
        accountingData[code] = val;
        perUnitData[code] = acres > 0 ? Math.round((val / acres) * 100) / 100 : 0;
      }

      // Recalculate parent sums
      const perUnitFinal = recalcParentSums(perUnitData, farmCategories);
      const accountingFinal = recalcParentSums(accountingData, farmCategories);

      const sourceYear = fy2025ByMonth[month] ? 'FY2025' : 'FY2024';
      console.log(`  ${month}: budget from ${sourceYear} — ${Object.keys(perUnitFinal).length} categories`);

      if (dryRun) {
        created++;
        continue;
      }

      // Upsert per_unit
      await prisma.monthlyData.upsert({
        where: {
          farm_id_fiscal_year_month_type: {
            farm_id: farm.id, fiscal_year: 2026, month, type: 'per_unit',
          },
        },
        update: { data_json: perUnitFinal, is_actual: false },
        create: {
          farm_id: farm.id, fiscal_year: 2026, month, type: 'per_unit',
          data_json: perUnitFinal, is_actual: false, comments_json: {},
        },
      });

      // Upsert accounting
      await prisma.monthlyData.upsert({
        where: {
          farm_id_fiscal_year_month_type: {
            farm_id: farm.id, fiscal_year: 2026, month, type: 'accounting',
          },
        },
        update: { data_json: accountingFinal, is_actual: false },
        create: {
          farm_id: farm.id, fiscal_year: 2026, month, type: 'accounting',
          data_json: accountingFinal, is_actual: false, comments_json: {},
        },
      });

      created++;
    }

    console.log(`  → ${created} months budgeted, ${skipped} skipped\n`);
  }

  if (dryRun) {
    console.log('--dry-run mode: no changes made.');
  } else {
    console.log('Done.');
  }
}

main()
  .catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
