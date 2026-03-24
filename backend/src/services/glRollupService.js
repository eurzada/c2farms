import prisma from '../config/database.js';
import { getFarmCategories, recalcParentSums } from './categoryService.js';

// Roll up GL actual details into category-level MonthlyData
export async function rollupGlActuals(farmId, fiscalYear, month, { basis = 'cash' } = {}) {
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

  // Build clean actual data from GL sums (no merge with plan data — Two Books architecture)
  const parentIdSet = new Set(farmCategories.filter(c => c.parent_id).map(c => c.parent_id));
  const leafCodes = farmCategories.filter(c => !parentIdSet.has(c.id)).map(c => c.code);
  const zeroed = {};
  for (const code of leafCodes) {
    zeroed[code] = 0;
  }

  // Start clean: zero all leaves, then overlay GL sums
  const merged = { ...zeroed, ...categorySums };
  const withParents = recalcParentSums(merged, farmCategories);

  // Upsert into MonthlyActual (Book 2: Actual P&L) — NOT MonthlyData (Book 1: Plan)
  await prisma.monthlyActual.upsert({
    where: {
      farm_id_fiscal_year_month_type: {
        farm_id: farmId, fiscal_year: fiscalYear, month, type: 'accounting',
      },
    },
    update: { data_json: withParents },
    create: {
      farm_id: farmId, fiscal_year: fiscalYear, month, type: 'accounting',
      data_json: withParents, basis, source: 'gl_rollup',
    },
  });

  // Cascade to per-unit actuals
  const assumption = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
  });
  if (!assumption) {
    console.warn(`[GL Rollup] No assumption record for farm=${farmId} FY=${fiscalYear}. Per-unit values will be zero.`);
  }
  const totalAcres = assumption?.total_acres ?? 0;

  const perUnitData = {};
  for (const [key, val] of Object.entries(withParents)) {
    perUnitData[key] = totalAcres > 0 ? val / totalAcres : 0;
  }

  await prisma.monthlyActual.upsert({
    where: {
      farm_id_fiscal_year_month_type: {
        farm_id: farmId, fiscal_year: fiscalYear, month, type: 'per_unit',
      },
    },
    update: { data_json: perUnitData },
    create: {
      farm_id: farmId, fiscal_year: fiscalYear, month, type: 'per_unit',
      data_json: perUnitData, basis: 'cash', source: 'gl_rollup',
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
