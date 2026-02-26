import prisma from '../config/database.js';
import { getFarmCategories, recalcParentSums, validateLeafCategory } from './categoryService.js';

// Update per-unit cell and cascade to accounting
export async function updatePerUnitCell(farmId, fiscalYear, month, categoryCode, value, comment) {
  await validateLeafCategory(farmId, categoryCode);
  const assumption = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
  });
  if (!assumption) throw Object.assign(new Error('Assumptions not found'), { status: 404 });

  const totalAcres = assumption.total_acres;
  const farmCategories = await getFarmCategories(farmId);

  // Update per-unit data
  const perUnit = await prisma.monthlyData.findUnique({
    where: {
      farm_id_fiscal_year_month_type: {
        farm_id: farmId, fiscal_year: fiscalYear, month, type: 'per_unit',
      },
    },
  });

  const perUnitData = { ...(perUnit?.data_json || {}) };
  perUnitData[categoryCode] = value;
  const recalcedPerUnit = recalcParentSums(perUnitData, farmCategories);

  const commentsData = { ...(perUnit?.comments_json || {}) };
  if (comment !== undefined) {
    commentsData[categoryCode] = comment;
  }

  await prisma.monthlyData.upsert({
    where: {
      farm_id_fiscal_year_month_type: {
        farm_id: farmId, fiscal_year: fiscalYear, month, type: 'per_unit',
      },
    },
    update: { data_json: recalcedPerUnit, comments_json: commentsData },
    create: {
      farm_id: farmId, fiscal_year: fiscalYear, month, type: 'per_unit',
      data_json: recalcedPerUnit, comments_json: commentsData,
    },
  });

  // Update accounting data (per-unit * acres)
  const accountingData = {};
  for (const [key, val] of Object.entries(recalcedPerUnit)) {
    accountingData[key] = val * totalAcres;
  }

  await prisma.monthlyData.upsert({
    where: {
      farm_id_fiscal_year_month_type: {
        farm_id: farmId, fiscal_year: fiscalYear, month, type: 'accounting',
      },
    },
    update: { data_json: accountingData },
    create: {
      farm_id: farmId, fiscal_year: fiscalYear, month, type: 'accounting',
      data_json: accountingData, comments_json: {},
    },
  });

  return { perUnit: recalcedPerUnit, accounting: accountingData };
}

// Update accounting cell and cascade to per-unit
// isActual: when true, marks the record as actual data (used by QB sync / manual-actual).
//           when false (default), preserves the existing is_actual flag (used by grid editing).
export async function updateAccountingCell(farmId, fiscalYear, month, categoryCode, value, { isActual = false } = {}) {
  await validateLeafCategory(farmId, categoryCode);
  const assumption = await prisma.assumption.findUnique({
    where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
  });
  if (!assumption) throw Object.assign(new Error('Assumptions not found'), { status: 404 });

  const totalAcres = assumption.total_acres;
  const farmCategories = await getFarmCategories(farmId);

  // Update accounting
  const accounting = await prisma.monthlyData.findUnique({
    where: {
      farm_id_fiscal_year_month_type: {
        farm_id: farmId, fiscal_year: fiscalYear, month, type: 'accounting',
      },
    },
  });

  const accountingData = { ...(accounting?.data_json || {}) };
  accountingData[categoryCode] = value;
  const recalcedAccounting = recalcParentSums(accountingData, farmCategories);

  const actualFlag = isActual || (accounting?.is_actual ?? false);

  await prisma.monthlyData.upsert({
    where: {
      farm_id_fiscal_year_month_type: {
        farm_id: farmId, fiscal_year: fiscalYear, month, type: 'accounting',
      },
    },
    update: { data_json: recalcedAccounting, ...(isActual && { is_actual: true }) },
    create: {
      farm_id: farmId, fiscal_year: fiscalYear, month, type: 'accounting',
      data_json: recalcedAccounting, is_actual: actualFlag, comments_json: {},
    },
  });

  // Update per-unit (accounting / acres)
  const perUnitData = {};
  for (const [key, val] of Object.entries(recalcedAccounting)) {
    perUnitData[key] = totalAcres > 0 ? val / totalAcres : 0;
  }

  await prisma.monthlyData.upsert({
    where: {
      farm_id_fiscal_year_month_type: {
        farm_id: farmId, fiscal_year: fiscalYear, month, type: 'per_unit',
      },
    },
    update: { data_json: perUnitData, ...(isActual && { is_actual: true }) },
    create: {
      farm_id: farmId, fiscal_year: fiscalYear, month, type: 'per_unit',
      data_json: perUnitData, is_actual: actualFlag, comments_json: {},
    },
  });

  return { perUnit: perUnitData, accounting: recalcedAccounting };
}

// Re-export recalcParentSums for use in routes that need it
export { recalcParentSums } from './categoryService.js';
