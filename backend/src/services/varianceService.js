import prisma from '../config/database.js';
import { getFarmCategories } from './categoryService.js';
import { generateFiscalMonths } from '../utils/fiscalYear.js';
const EXPENSE_PARENT_CODES = ['inputs', 'lpm', 'lbf', 'insurance'];

/**
 * Calculate plan vs actual variance for a single farm.
 */
export async function calculateVariance(farmId, fiscalYear) {
  const months = generateFiscalMonths('Nov');
  const farmCategories = await getFarmCategories(farmId);

  const assumption = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
  });
  const totalAcres = assumption?.total_acres || 0;

  const [planData, actualData] = await Promise.all([
    prisma.monthlyData.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
    }),
    prisma.monthlyActual.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
    }),
  ]);

  // Build month maps
  const planByMonth = {};
  for (const row of planData) planByMonth[row.month] = row.data_json || {};
  const actualByMonth = {};
  for (const row of actualData) actualByMonth[row.month] = row.data_json || {};

  // Determine which months have actuals
  const hasActuals = {};
  for (const month of months) hasActuals[month] = !!actualByMonth[month];

  // Build per-category variance
  const expenseCategories = farmCategories.filter(
    c => c.category_type !== 'REVENUE' && !c.code?.startsWith('rev_')
  );

  const byCategory = expenseCategories
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(cat => {
      let planTotal = 0;
      let actualTotal = 0;
      const planMonths = {};
      const actualMonths = {};

      for (const month of months) {
        const p = planByMonth[month]?.[cat.code] || 0;
        const a = actualByMonth[month]?.[cat.code] || 0;
        planMonths[month] = p;
        actualMonths[month] = a;
        planTotal += p;
        actualTotal += a;
      }

      const variance = actualTotal - planTotal;
      const pctDiff = planTotal !== 0 ? (variance / Math.abs(planTotal)) * 100 : 0;

      return {
        code: cat.code,
        display_name: cat.display_name,
        level: cat.level,
        category_type: cat.category_type,
        sort_order: cat.sort_order,
        planTotal,
        actualTotal,
        variance,
        pctDiff,
        planMonths,
        actualMonths,
      };
    });

  // Grand totals (sum of expense parents only)
  const parentRows = byCategory.filter(r => EXPENSE_PARENT_CODES.includes(r.code));
  const planGrandTotal = parentRows.reduce((s, r) => s + r.planTotal, 0);
  const actualGrandTotal = parentRows.reduce((s, r) => s + r.actualTotal, 0);

  return {
    farmId,
    fiscalYear,
    months,
    totalAcres,
    hasActuals,
    byCategory,
    planGrandTotal,
    actualGrandTotal,
    totalVariance: actualGrandTotal - planGrandTotal,
    totalPctDiff: planGrandTotal !== 0 ? ((actualGrandTotal - planGrandTotal) / Math.abs(planGrandTotal)) * 100 : 0,
    // Waterfall data (parent categories only)
    waterfall: parentRows.map(r => ({
      code: r.code,
      name: r.display_name,
      planTotal: r.planTotal,
      actualTotal: r.actualTotal,
      delta: r.variance,
    })),
  };
}

/**
 * Calculate enterprise-wide variance across all BU farms.
 */
export async function calculateEnterpriseVariance(fiscalYear) {
  const buFarms = await prisma.farm.findMany({
    where: { is_enterprise: false, farm_type: { not: 'terminal' } },
    orderBy: { name: 'asc' },
  });

  const buVariances = await Promise.all(
    buFarms.map(async (farm) => {
      const assumption = await prisma.assumption.findUnique({
        where: { farm_id_fiscal_year: { farm_id: farm.id, fiscal_year: fiscalYear } },
      });
      const v = await calculateVariance(farm.id, fiscalYear);
      return { ...v, farmName: farm.name, acres: assumption?.total_acres || 0 };
    })
  );

  // Aggregate waterfall across all BUs
  const waterfallMap = {};
  let planGrandTotal = 0;
  let actualGrandTotal = 0;

  for (const bu of buVariances) {
    planGrandTotal += bu.planGrandTotal;
    actualGrandTotal += bu.actualGrandTotal;
    for (const bar of bu.waterfall) {
      if (!waterfallMap[bar.code]) {
        waterfallMap[bar.code] = { code: bar.code, name: bar.name, planTotal: 0, actualTotal: 0, delta: 0 };
      }
      waterfallMap[bar.code].planTotal += bar.planTotal;
      waterfallMap[bar.code].actualTotal += bar.actualTotal;
      waterfallMap[bar.code].delta += bar.delta;
    }
  }

  return {
    fiscalYear,
    planGrandTotal,
    actualGrandTotal,
    totalVariance: actualGrandTotal - planGrandTotal,
    totalPctDiff: planGrandTotal !== 0 ? ((actualGrandTotal - planGrandTotal) / Math.abs(planGrandTotal)) * 100 : 0,
    waterfall: Object.values(waterfallMap),
    perBu: buVariances.map(bu => ({
      farmId: bu.farmId,
      farmName: bu.farmName,
      acres: bu.acres,
      planTotal: bu.planGrandTotal,
      actualTotal: bu.actualGrandTotal,
      variance: bu.totalVariance,
      pctDiff: bu.totalPctDiff,
    })),
  };
}
