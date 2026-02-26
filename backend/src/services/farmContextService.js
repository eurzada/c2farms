import prisma from '../config/database.js';
import { getFarmCategories } from './categoryService.js';
import { calculateForecast } from './forecastService.js';
import { generateFiscalMonths, getCurrentFiscalMonth } from '../utils/fiscalYear.js';

/**
 * Assembles all relevant farm data into one structured object for AI consumption.
 */
export async function buildFarmContext(farmId, fiscalYear, options = {}) {
  const { includeGlDetail = false } = options;

  // Fetch core data in parallel
  const [farm, assumption, categories, monthlyPerUnit, monthlyAccounting, frozenPerUnit, frozenAccounting, priorYearPerUnit] = await Promise.all([
    prisma.farm.findUnique({ where: { id: farmId } }),
    prisma.assumption.findUnique({ where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } } }),
    getFarmCategories(farmId),
    prisma.monthlyData.findMany({ where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'per_unit' } }),
    prisma.monthlyData.findMany({ where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' } }),
    prisma.monthlyDataFrozen.findMany({ where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'per_unit' } }),
    prisma.monthlyDataFrozen.findMany({ where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' } }),
    prisma.monthlyData.findMany({ where: { farm_id: farmId, fiscal_year: fiscalYear - 1, type: 'per_unit' } }),
  ]);

  if (!farm) return null;

  const startMonth = assumption?.start_month || 'Nov';
  const months = generateFiscalMonths(startMonth);
  const { fiscalYear: currentFY, monthName: currentMonth } = getCurrentFiscalMonth(startMonth);

  // Build monthly data maps
  const buildMonthMap = (rows) => {
    const map = {};
    for (const row of rows) {
      map[row.month] = { data: row.data_json || {}, isActual: row.is_actual };
    }
    return map;
  };

  const perUnitMap = buildMonthMap(monthlyPerUnit);
  const accountingMap = buildMonthMap(monthlyAccounting);
  const frozenPUMap = {};
  for (const row of frozenPerUnit) frozenPUMap[row.month] = row.data_json || {};
  const frozenAccMap = {};
  for (const row of frozenAccounting) frozenAccMap[row.month] = row.data_json || {};

  // Build category hierarchy info
  const categoryHierarchy = categories.map(c => ({
    code: c.code,
    displayName: c.display_name,
    level: c.level,
    parentId: c.parent_id,
    categoryType: c.category_type,
    sortOrder: c.sort_order,
  }));

  // Build per-unit monthly data
  const perUnitMonthly = {};
  const accountingMonthly = {};
  for (const month of months) {
    perUnitMonthly[month] = {
      data: perUnitMap[month]?.data || {},
      isActual: perUnitMap[month]?.isActual || false,
    };
    accountingMonthly[month] = {
      data: accountingMap[month]?.data || {},
      isActual: accountingMap[month]?.isActual || false,
    };
  }

  // Compute YTD totals from leaf categories
  const leafCodes = categories.filter(c => !categories.some(ch => ch.parent_id === c.id)).map(c => c.code);
  const ytdTotals = {};
  for (const code of leafCodes) {
    ytdTotals[code] = 0;
    for (const month of months) {
      const val = perUnitMap[month]?.data?.[code] || 0;
      ytdTotals[code] += val;
    }
  }

  // Prior year aggregate
  const priorYearTotals = {};
  for (const row of priorYearPerUnit) {
    const data = row.data_json || {};
    for (const [code, val] of Object.entries(data)) {
      priorYearTotals[code] = (priorYearTotals[code] || 0) + (val || 0);
    }
  }

  // Frozen budget totals
  const frozenBudgetTotals = {};
  for (const month of months) {
    const data = frozenPUMap[month] || {};
    for (const [code, val] of Object.entries(data)) {
      frozenBudgetTotals[code] = (frozenBudgetTotals[code] || 0) + (val || 0);
    }
  }

  // Optional: GL detail
  let glDetail = null;
  if (includeGlDetail) {
    const glAccounts = await prisma.glAccount.findMany({
      where: { farm_id: farmId, is_active: true },
      include: { category: { select: { code: true, display_name: true } } },
    });
    const glActuals = await prisma.glActualDetail.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear },
    });

    const glMap = {};
    for (const gl of glAccounts) {
      glMap[gl.id] = { accountNumber: gl.account_number, accountName: gl.account_name, categoryCode: gl.category?.code, months: {} };
    }
    for (const actual of glActuals) {
      if (glMap[actual.gl_account_id]) {
        glMap[actual.gl_account_id].months[actual.month] = actual.amount;
      }
    }
    glDetail = Object.values(glMap);
  }

  // Calculate forecast if budget is frozen
  let forecast = null;
  if (assumption?.is_frozen) {
    try {
      forecast = await calculateForecast(farmId, fiscalYear, startMonth);
    } catch {
      // Forecast calculation may fail if data is incomplete
    }
  }

  return {
    farm: {
      id: farm.id,
      name: farm.name,
    },
    fiscalYear,
    currentMonth,
    currentFiscalYear: currentFY,
    months,
    assumptions: assumption ? {
      totalAcres: assumption.total_acres,
      crops: assumption.crops_json || [],
      bins: assumption.bins_json || [],
      isFrozen: assumption.is_frozen,
      frozenAt: assumption.frozen_at,
      startMonth: assumption.start_month,
    } : null,
    categories: categoryHierarchy,
    perUnit: perUnitMonthly,
    accounting: accountingMonthly,
    frozenBudget: {
      perUnit: frozenPUMap,
      accounting: frozenAccMap,
      totals: frozenBudgetTotals,
    },
    ytdTotals,
    priorYear: {
      totals: priorYearTotals,
      fiscalYear: fiscalYear - 1,
    },
    forecast,
    glDetail,
  };
}

/**
 * Converts the structured context into a concise text summary suitable for LLM system prompts.
 */
export function contextToTextSummary(context) {
  if (!context) return 'No farm data available.';

  const lines = [];
  lines.push(`Farm: ${context.farm.name}`);
  lines.push(`Fiscal Year: ${context.fiscalYear} (${context.months[0]}-${context.months[11]})`);
  lines.push(`Current Month: ${context.currentMonth}`);

  if (context.assumptions) {
    const a = context.assumptions;
    lines.push(`\nAssumptions:`);
    lines.push(`  Total Acres: ${a.totalAcres.toLocaleString()}`);
    lines.push(`  Budget Status: ${a.isFrozen ? 'Frozen' : 'Draft'}`);
    if (a.crops.length > 0) {
      lines.push(`  Crops:`);
      for (const crop of a.crops) {
        lines.push(`    - ${crop.name}: ${crop.acres} acres, target yield ${crop.target_yield}, price $${crop.price_per_unit}/unit`);
      }
    }
  }

  // Revenue and expense totals from YTD
  const revCodes = Object.keys(context.ytdTotals).filter(k => k.startsWith('rev_'));
  const totalRevenue = revCodes.reduce((sum, k) => sum + (context.ytdTotals[k] || 0), 0);
  const inputCodes = Object.keys(context.ytdTotals).filter(k => k.startsWith('input_'));
  const totalInputs = inputCodes.reduce((sum, k) => sum + (context.ytdTotals[k] || 0), 0);
  const lpmCodes = Object.keys(context.ytdTotals).filter(k => k.startsWith('lpm_'));
  const totalLPM = lpmCodes.reduce((sum, k) => sum + (context.ytdTotals[k] || 0), 0);
  const lbfCodes = Object.keys(context.ytdTotals).filter(k => k.startsWith('lbf_'));
  const totalLBF = lbfCodes.reduce((sum, k) => sum + (context.ytdTotals[k] || 0), 0);
  const insCodes = Object.keys(context.ytdTotals).filter(k => k.startsWith('ins_'));
  const totalInsurance = insCodes.reduce((sum, k) => sum + (context.ytdTotals[k] || 0), 0);
  const totalExpense = totalInputs + totalLPM + totalLBF + totalInsurance;
  const profit = totalRevenue - totalExpense;

  const fmt = (v) => `$${v.toFixed(2)}/acre`;

  lines.push(`\nYTD Per-Unit Summary ($/acre, all 12 months):`);
  lines.push(`  Revenue: ${fmt(totalRevenue)}`);
  lines.push(`  Inputs: ${fmt(totalInputs)}`);
  lines.push(`  Labour/Power/Machinery: ${fmt(totalLPM)}`);
  lines.push(`  Land/Building/Finance: ${fmt(totalLBF)}`);
  lines.push(`  Insurance: ${fmt(totalInsurance)}`);
  lines.push(`  Total Expense: ${fmt(totalExpense)}`);
  lines.push(`  Profit: ${fmt(profit)}`);

  if (context.forecast) {
    const fRevenue = context.forecast['revenue'];
    const fProfit = fRevenue ? (fRevenue.forecastTotal - (context.forecast['inputs']?.forecastTotal || 0) - (context.forecast['lpm']?.forecastTotal || 0) - (context.forecast['lbf']?.forecastTotal || 0) - (context.forecast['insurance']?.forecastTotal || 0)) : 0;
    lines.push(`\nForecast:`);
    if (fRevenue) lines.push(`  Forecast Revenue: ${fmt(fRevenue.forecastTotal)}, Budget: ${fmt(fRevenue.frozenBudgetTotal)}, Variance: ${fmt(fRevenue.variance)}`);
    lines.push(`  Forecast Profit: ${fmt(fProfit)}`);
  }

  if (Object.keys(context.priorYear.totals).length > 0) {
    const pyRev = Object.entries(context.priorYear.totals).filter(([k]) => k.startsWith('rev_')).reduce((s, [, v]) => s + v, 0);
    lines.push(`\nPrior Year (FY${context.priorYear.fiscalYear}):`);
    lines.push(`  Revenue: ${fmt(pyRev)}`);
  }

  // Monthly breakdown for revenue
  lines.push(`\nMonthly Revenue ($/acre):`);
  for (const month of context.months) {
    const data = context.perUnit[month]?.data || {};
    const monthRev = revCodes.reduce((sum, k) => sum + (data[k] || 0), 0);
    const actual = context.perUnit[month]?.isActual ? ' (actual)' : '';
    lines.push(`  ${month}: ${fmt(monthRev)}${actual}`);
  }

  return lines.join('\n');
}
