/**
 * Two Books Migration Script
 *
 * Rebuilds MonthlyActual (Book 2: Actual P&L) from GlActualDetail source data,
 * and restores plan values in MonthlyData (Book 1: Plan P&L) where they were
 * previously overwritten by GL imports.
 *
 * This script is idempotent — running it twice produces the same result.
 *
 * Usage: node --experimental-modules src/scripts/migrateTwoBooks.js
 */

import prisma from '../config/database.js';
import { rollupGlActuals } from '../services/glRollupService.js';
import createLogger from '../utils/logger.js';

const log = createLogger('migrate-two-books');

async function migrate() {
  log.info('=== Two Books Migration ===');

  // Step 1: Rebuild MonthlyActual from GlActualDetail
  log.info('Step 1: Rebuilding MonthlyActual from GlActualDetail...');

  const distinctMonths = await prisma.$queryRaw`
    SELECT DISTINCT farm_id, fiscal_year, month
    FROM gl_actual_details
    ORDER BY farm_id, fiscal_year, month
  `;

  log.info(`Found ${distinctMonths.length} unique (farm, FY, month) combinations in GlActualDetail`);

  let rollupCount = 0;
  for (const { farm_id, fiscal_year, month } of distinctMonths) {
    try {
      await rollupGlActuals(farm_id, fiscal_year, month);
      rollupCount++;
    } catch (err) {
      log.error(`Failed rollup: farm=${farm_id} FY=${fiscal_year} ${month}: ${err.message}`);
    }
  }

  log.info(`Rolled up ${rollupCount} months into MonthlyActual`);

  // Verify MonthlyActual row counts
  const actualCount = await prisma.monthlyActual.count();
  log.info(`MonthlyActual now has ${actualCount} rows`);

  // Step 2: Restore plan values in MonthlyData where actuals overwrote them
  log.info('Step 2: Restoring plan data in MonthlyData...');

  const overwrittenRows = await prisma.monthlyData.findMany({
    where: { is_actual: true },
  });

  log.info(`Found ${overwrittenRows.length} MonthlyData rows with is_actual=true (plan overwritten)`);

  // Reset these rows — clear the GL data and mark as non-actual
  // Plan values for covered categories will be restored by re-running module pushes
  let resetCount = 0;
  for (const row of overwrittenRows) {
    await prisma.monthlyData.update({
      where: { id: row.id },
      data: { data_json: {}, is_actual: false },
    });
    resetCount++;
  }

  log.info(`Reset ${resetCount} MonthlyData rows (cleared GL data, set is_actual=false)`);
  log.info('Plan values for input_seed/input_fert/input_chem and lpm_personnel can be');
  log.info('restored by re-running agronomy and labour pushToForecast on each farm.');
  log.info('Other categories (lpm_fog, lpm_repairs, lpm_shop, lbf, insurance) will need');
  log.info('manual re-entry if they had plan values before actuals overwrote them.');

  // Step 3: Summary
  const planCount = await prisma.monthlyData.count();
  const finalActualCount = await prisma.monthlyActual.count();

  log.info('=== Migration Complete ===');
  log.info(`Book 1 (Plan - MonthlyData): ${planCount} rows`);
  log.info(`Book 2 (Actual - MonthlyActual): ${finalActualCount} rows`);
  log.info(`GL source data (GlActualDetail): ${distinctMonths.length} farm/month combos`);
}

migrate()
  .catch(err => {
    log.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
