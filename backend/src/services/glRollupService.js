import prisma from '../config/database.js';
import { getFarmCategories, recalcParentSums } from './categoryService.js';

// Roll up GL actual details into category-level MonthlyData
export async function rollupGlActuals(farmId, fiscalYear, month) {
  const farmCategories = await getFarmCategories(farmId);

  // Query all GL actuals for this farm/year/month, joined with GL accounts for category mapping
  const glActuals = await prisma.glActualDetail.findMany({
    where: { farm_id: farmId, fiscal_year: fiscalYear, month },
    include: {
      gl_account: {
        include: { category: true },
      },
    },
  });

  // Sum amounts by category code
  const categorySums = {};
  for (const actual of glActuals) {
    const categoryCode = actual.gl_account?.category?.code;
    if (!categoryCode) continue;
    categorySums[categoryCode] = (categorySums[categoryCode] || 0) + actual.amount;
  }

  // Merge with existing accounting data (preserve any manually-entered data for unmapped categories)
  const existing = await prisma.monthlyData.findUnique({
    where: {
      farm_id_fiscal_year_month_type: {
        farm_id: farmId, fiscal_year: fiscalYear, month, type: 'accounting',
      },
    },
  });

  const currentData = existing?.data_json || {};

  // Zero out all leaf categories first so deactivated/remapped accounts don't leave stale values
  const parentIdSet = new Set(farmCategories.filter(c => c.parent_id).map(c => c.parent_id));
  const leafCodes = farmCategories.filter(c => !parentIdSet.has(c.id)).map(c => c.code);
  const zeroed = {};
  for (const code of leafCodes) {
    zeroed[code] = 0;
  }

  // Merge: start with existing data, zero all leaf categories, then apply GL sums
  const merged = { ...currentData, ...zeroed, ...categorySums };
  const withParents = recalcParentSums(merged, farmCategories);

  // Upsert accounting data
  await prisma.monthlyData.upsert({
    where: {
      farm_id_fiscal_year_month_type: {
        farm_id: farmId, fiscal_year: fiscalYear, month, type: 'accounting',
      },
    },
    update: { data_json: withParents, is_actual: true },
    create: {
      farm_id: farmId, fiscal_year: fiscalYear, month, type: 'accounting',
      data_json: withParents, is_actual: true, comments_json: {},
    },
  });

  // Cascade to per-unit
  const assumption = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
  });
  if (!assumption) {
    console.warn(`[GL Rollup] No assumption record for farm=${farmId} FY=${fiscalYear}. Per-unit will divide by 1 (showing raw dollar amounts).`);
  }
  const totalAcres = assumption?.total_acres || 1;

  const perUnitData = {};
  for (const [key, val] of Object.entries(withParents)) {
    perUnitData[key] = val / totalAcres;
  }

  await prisma.monthlyData.upsert({
    where: {
      farm_id_fiscal_year_month_type: {
        farm_id: farmId, fiscal_year: fiscalYear, month, type: 'per_unit',
      },
    },
    update: { data_json: perUnitData, is_actual: true },
    create: {
      farm_id: farmId, fiscal_year: fiscalYear, month, type: 'per_unit',
      data_json: perUnitData, is_actual: true, comments_json: {},
    },
  });

  return { accounting: withParents, perUnit: perUnitData };
}

// Import GL actual detail records in bulk and trigger rollup
export async function importGlActuals(farmId, fiscalYear, glRows) {
  // glRows: [{ account_number, month, amount }]
  const monthsAffected = new Set();

  await prisma.$transaction(async (tx) => {
    for (const row of glRows) {
      // Look up GL account
      const glAccount = await tx.glAccount.findUnique({
        where: { farm_id_account_number: { farm_id: farmId, account_number: row.account_number } },
      });
      if (!glAccount) continue;

      monthsAffected.add(row.month);

      await tx.glActualDetail.upsert({
        where: {
          farm_id_fiscal_year_month_gl_account_id: {
            farm_id: farmId,
            fiscal_year: fiscalYear,
            month: row.month,
            gl_account_id: glAccount.id,
          },
        },
        update: { amount: row.amount },
        create: {
          farm_id: farmId,
          fiscal_year: fiscalYear,
          month: row.month,
          gl_account_id: glAccount.id,
          amount: row.amount,
        },
      });
    }
  });

  // Rollup each affected month
  const results = {};
  for (const month of monthsAffected) {
    results[month] = await rollupGlActuals(farmId, fiscalYear, month);
  }

  return { monthsImported: monthsAffected.size, results };
}
