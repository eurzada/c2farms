import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { getFarmCategories } from '../services/categoryService.js';
import { generateFiscalMonths, parseYear } from '../utils/fiscalYear.js';
import createLogger from '../utils/logger.js';

const log = createLogger('enterprise-forecast');
const router = Router();

// Expense-only category codes from defaultCategoryTemplate (standardised across all BUs)
const EXPENSE_PARENT_CODES = ['inputs', 'lpm', 'lbf', 'insurance'];

/**
 * GET /api/enterprise/forecast-rollup/:year
 *
 * Consolidated forecast rollup across all BU farms.
 * Returns accounting rows (total $), per-unit rows ($/acre weighted average),
 * drill-down breakdowns, and dashboard aggregates.
 */
router.get('/forecast-rollup/:year', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = parseYear(req.params.year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    // Find all BU farms (not enterprise, not terminal)
    const buFarms = await prisma.farm.findMany({
      where: { is_enterprise: false, farm_type: { not: 'terminal' } },
      orderBy: { name: 'asc' },
    });

    if (!buFarms.length) {
      return res.json({ fiscalYear, months: [], totalAcres: 0, farms: [], accountingRows: [], perUnitRows: [], drillDown: {}, dashboard: {} });
    }

    const months = generateFiscalMonths('Nov');

    // Fetch data for all BUs in parallel
    const buResults = await Promise.all(buFarms.map(async (farm) => {
      const [assumption, acctData, acctFrozen, priorAcct, categories] = await Promise.all([
        prisma.assumption.findUnique({
          where: { farm_id_fiscal_year: { farm_id: farm.id, fiscal_year: fiscalYear } },
        }),
        prisma.monthlyData.findMany({
          where: { farm_id: farm.id, fiscal_year: fiscalYear, type: 'accounting' },
        }),
        prisma.monthlyDataFrozen.findMany({
          where: { farm_id: farm.id, fiscal_year: fiscalYear, type: 'accounting' },
        }),
        prisma.monthlyData.findMany({
          where: { farm_id: farm.id, fiscal_year: fiscalYear - 1, type: 'accounting' },
        }),
        getFarmCategories(farm.id),
      ]);

      // Build month maps
      const monthMap = {};
      for (const row of acctData) {
        monthMap[row.month] = row.data_json || {};
      }

      const frozenMap = {};
      for (const row of acctFrozen) {
        frozenMap[row.month] = row.data_json || {};
      }

      const priorMap = {};
      for (const row of priorAcct) {
        for (const [key, val] of Object.entries(row.data_json || {})) {
          priorMap[key] = (priorMap[key] || 0) + val;
        }
      }

      return {
        farm,
        assumption,
        categories,
        monthMap,
        frozenMap,
        priorMap,
        totalAcres: assumption?.total_acres || 0,
        isFrozen: assumption?.is_frozen || false,
        cropCount: assumption?.crops_json?.length || 0,
      };
    }));

    const totalAcres = buResults.reduce((sum, bu) => sum + bu.totalAcres, 0);

    // Build unified expense category list from union of all BU categories
    const categoryMap = new Map(); // code -> { display_name, level, sort_order, category_type, parent_code }
    for (const bu of buResults) {
      for (const cat of bu.categories) {
        // Skip revenue categories
        if (cat.category_type === 'REVENUE') continue;
        if (cat.code?.startsWith('rev_')) continue;

        if (!categoryMap.has(cat.code)) {
          const parentCode = cat.parent_id
            ? bu.categories.find(c => c.id === cat.parent_id)?.code || null
            : null;
          categoryMap.set(cat.code, {
            code: cat.code,
            display_name: cat.display_name,
            level: cat.level,
            sort_order: cat.sort_order,
            category_type: cat.category_type,
            parent_code: parentCode,
          });
        }
      }
    }

    // Sort categories by sort_order
    const unifiedCategories = [...categoryMap.values()].sort((a, b) => a.sort_order - b.sort_order);

    // Aggregate accounting values across all BUs
    const consolidated = {}; // code -> { months: {Nov: sum}, priorYear: sum, frozen: {Nov: sum} }
    for (const cat of unifiedCategories) {
      consolidated[cat.code] = { months: {}, priorYear: 0, frozen: {} };
      for (const month of months) {
        consolidated[cat.code].months[month] = 0;
        consolidated[cat.code].frozen[month] = 0;
      }
    }

    // Build drill-down data at the same time
    const drillDown = {};
    for (const cat of unifiedCategories) {
      drillDown[cat.code] = [];
    }

    for (const bu of buResults) {
      for (const cat of unifiedCategories) {
        let forecastTotal = 0;
        let budgetTotal = 0;
        const buMonths = {};

        for (const month of months) {
          const val = bu.monthMap[month]?.[cat.code] || 0;
          const frozenVal = bu.frozenMap[month]?.[cat.code] || 0;

          consolidated[cat.code].months[month] += val;
          consolidated[cat.code].frozen[month] += frozenVal;

          buMonths[month] = val;
          forecastTotal += val;
          budgetTotal += bu.isFrozen ? frozenVal : val;
        }

        consolidated[cat.code].priorYear += bu.priorMap[cat.code] || 0;

        drillDown[cat.code].push({
          farmId: bu.farm.id,
          farmName: bu.farm.name,
          acres: bu.totalAcres,
          months: buMonths,
          forecastTotal,
          budgetTotal,
        });
      }
    }

    // Determine if any BU has frozen budget (for variance display)
    const anyFrozen = buResults.some(bu => bu.isFrozen);

    // Build accounting rows (same shape as financial.js)
    const accountingRows = unifiedCategories.map(cat => {
      const c = consolidated[cat.code];
      let forecastTotal = 0;
      let frozenBudgetTotal = 0;

      for (const month of months) {
        forecastTotal += c.months[month];
        frozenBudgetTotal += c.frozen[month];
      }

      const budgetVal = anyFrozen ? frozenBudgetTotal : forecastTotal;
      const variance = forecastTotal - budgetVal;
      const pctDiff = budgetVal !== 0 ? (variance / Math.abs(budgetVal)) * 100 : 0;

      return {
        code: cat.code,
        display_name: cat.display_name,
        level: cat.level,
        parent_code: cat.parent_code,
        category_type: cat.category_type,
        sort_order: cat.sort_order,
        months: c.months,
        priorYear: c.priorYear,
        forecastTotal,
        frozenBudgetTotal: budgetVal,
        variance,
        pctDiff,
      };
    });

    // Compute Total Expense row
    const expenseParentRows = accountingRows.filter(r => EXPENSE_PARENT_CODES.includes(r.code));
    if (expenseParentRows.length > 0) {
      const totalExpMonths = {};
      let totalExpForecast = 0;
      let totalExpBudget = 0;
      let totalExpPrior = 0;

      for (const month of months) {
        const val = expenseParentRows.reduce((sum, r) => sum + (r.months[month] || 0), 0);
        totalExpMonths[month] = val;
      }

      totalExpForecast = expenseParentRows.reduce((sum, r) => sum + r.forecastTotal, 0);
      totalExpBudget = expenseParentRows.reduce((sum, r) => sum + r.frozenBudgetTotal, 0);
      totalExpPrior = expenseParentRows.reduce((sum, r) => sum + r.priorYear, 0);

      accountingRows.push({
        code: '_total_expense',
        display_name: 'Total Expense',
        level: -1,
        parent_code: null,
        category_type: 'COMPUTED',
        sort_order: 998,
        months: totalExpMonths,
        priorYear: totalExpPrior,
        isComputed: true,
        forecastTotal: totalExpForecast,
        frozenBudgetTotal: totalExpBudget,
        variance: totalExpForecast - totalExpBudget,
        pctDiff: totalExpBudget !== 0 ? ((totalExpForecast - totalExpBudget) / Math.abs(totalExpBudget)) * 100 : 0,
      });
    }

    // Build per-unit rows (weighted average: accounting / totalAcres)
    const divisor = totalAcres || 1;
    const perUnitRows = accountingRows.map(row => {
      const puMonths = {};
      for (const month of months) {
        puMonths[month] = row.months[month] / divisor;
      }
      return {
        ...row,
        months: puMonths,
        priorYear: row.priorYear / divisor,
        forecastTotal: row.forecastTotal / divisor,
        frozenBudgetTotal: row.frozenBudgetTotal / divisor,
        variance: row.variance / divisor,
        pctDiff: row.pctDiff, // percentage stays the same
      };
    });

    // Build dashboard aggregates
    const totalExpRow = accountingRows.find(r => r.code === '_total_expense');
    const dashboard = {
      totalExpenseForecast: totalExpRow?.forecastTotal || 0,
      totalExpenseBudget: totalExpRow?.frozenBudgetTotal || 0,
      totalExpenseVariance: totalExpRow?.variance || 0,
      expensePerAcre: totalExpRow ? totalExpRow.forecastTotal / divisor : 0,
      budgetPerAcre: totalExpRow ? totalExpRow.frozenBudgetTotal / divisor : 0,
      anyFrozen,
      categoryBreakdown: expenseParentRows.map(r => ({
        code: r.code,
        name: r.display_name,
        forecastTotal: r.forecastTotal,
        budgetTotal: r.frozenBudgetTotal,
        variance: r.variance,
        forecastPerAcre: r.forecastTotal / divisor,
        budgetPerAcre: r.frozenBudgetTotal / divisor,
      })),
      perBuSummary: buResults.map(bu => {
        // Per-BU total expense
        let buExpForecast = 0;
        let buExpBudget = 0;
        for (const parentCode of EXPENSE_PARENT_CODES) {
          for (const month of months) {
            buExpForecast += bu.monthMap[month]?.[parentCode] || 0;
            buExpBudget += bu.isFrozen ? (bu.frozenMap[month]?.[parentCode] || 0) : (bu.monthMap[month]?.[parentCode] || 0);
          }
        }
        const buAcres = bu.totalAcres || 1;
        return {
          farmId: bu.farm.id,
          name: bu.farm.name,
          acres: bu.totalAcres,
          expensePerAcre: buExpForecast / buAcres,
          budgetPerAcre: buExpBudget / buAcres,
          variance: (buExpForecast - buExpBudget) / buAcres,
          isFrozen: bu.isFrozen,
        };
      }),
    };

    res.json({
      fiscalYear,
      months,
      totalAcres,
      farms: buResults.map(bu => ({
        id: bu.farm.id,
        name: bu.farm.name,
        acres: bu.totalAcres,
        isFrozen: bu.isFrozen,
        cropCount: bu.cropCount,
      })),
      frozenCount: buResults.filter(bu => bu.isFrozen).length,
      totalFarms: buResults.length,
      accountingRows,
      perUnitRows,
      drillDown,
      dashboard,
    });
  } catch (err) {
    log.error('Forecast rollup error', err);
    next(err);
  }
});

/**
 * GET /api/enterprise/bu-summary/:year
 *
 * BU-level P&L summary: Revenue, Inputs, Gross Margin, then cost categories,
 * with per-acre values and a break-even $/acre for each BU + consolidated.
 */
router.get('/bu-summary/:year', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = parseYear(req.params.year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const buFarms = await prisma.farm.findMany({
      where: { is_enterprise: false, farm_type: { not: 'terminal' } },
      orderBy: { name: 'asc' },
    });

    const buSummaries = await Promise.all(buFarms.map(async (farm) => {
      const [assumption, acctData, agroAllocations] = await Promise.all([
        prisma.assumption.findUnique({
          where: { farm_id_fiscal_year: { farm_id: farm.id, fiscal_year: fiscalYear } },
        }),
        prisma.monthlyData.findMany({
          where: { farm_id: farm.id, fiscal_year: fiscalYear, type: 'accounting' },
        }),
        prisma.cropAllocation.findMany({
          where: { plan: { farm_id: farm.id, crop_year: fiscalYear } },
        }),
      ]);

      const acres = assumption?.total_acres || 0;
      const div = acres || 1;

      // Aggregate expense categories from plan MonthlyData
      const agg = {};
      for (const row of acctData) {
        for (const [key, val] of Object.entries(row.data_json || {})) {
          agg[key] = (agg[key] || 0) + val;
        }
      }

      // Revenue from agronomy crop allocations
      const grossRevenue = agroAllocations.reduce(
        (sum, ca) => sum + (ca.acres || 0) * (ca.target_yield_bu || 0) * (ca.commodity_price || 0), 0
      );

      const inputs = agg['inputs'] || 0;
      const personnel = agg['lpm_personnel'] || 0;
      const fuel = agg['lpm_fog'] || 0;
      const repairs = agg['lpm_repairs'] || 0;
      const shop = agg['lpm_shop'] || 0;
      const lbf = agg['lbf'] || 0;
      const insurance = agg['insurance'] || 0;
      const totalExpense = inputs + personnel + fuel + repairs + shop + lbf + insurance;
      const grossMargin = grossRevenue - inputs;
      const netMargin = grossRevenue - totalExpense;
      const breakEvenPerAcre = acres > 0 ? totalExpense / acres : 0;

      return {
        farmId: farm.id,
        name: farm.name,
        acres,
        revenue: grossRevenue,
        revenuePerAcre: grossRevenue / div,
        inputs,
        inputsPerAcre: inputs / div,
        grossMargin,
        grossMarginPerAcre: grossMargin / div,
        personnel,
        personnelPerAcre: personnel / div,
        fuel,
        fuelPerAcre: fuel / div,
        repairs,
        repairsPerAcre: repairs / div,
        shop,
        shopPerAcre: shop / div,
        lbf,
        lbfPerAcre: lbf / div,
        insurance,
        insurancePerAcre: insurance / div,
        totalExpense,
        totalExpensePerAcre: totalExpense / div,
        netMargin,
        netMarginPerAcre: netMargin / div,
        breakEvenPerAcre,
      };
    }));

    // Consolidated totals
    const totalAcres = buSummaries.reduce((s, bu) => s + bu.acres, 0);
    const div = totalAcres || 1;
    const sumField = (field) => buSummaries.reduce((s, bu) => s + bu[field], 0);

    const consolidated = {
      name: 'Consolidated',
      acres: totalAcres,
      revenue: sumField('revenue'),
      revenuePerAcre: sumField('revenue') / div,
      inputs: sumField('inputs'),
      inputsPerAcre: sumField('inputs') / div,
      grossMargin: sumField('grossMargin'),
      grossMarginPerAcre: sumField('grossMargin') / div,
      personnel: sumField('personnel'),
      personnelPerAcre: sumField('personnel') / div,
      fuel: sumField('fuel'),
      fuelPerAcre: sumField('fuel') / div,
      repairs: sumField('repairs'),
      repairsPerAcre: sumField('repairs') / div,
      shop: sumField('shop'),
      shopPerAcre: sumField('shop') / div,
      lbf: sumField('lbf'),
      lbfPerAcre: sumField('lbf') / div,
      insurance: sumField('insurance'),
      insurancePerAcre: sumField('insurance') / div,
      totalExpense: sumField('totalExpense'),
      totalExpensePerAcre: sumField('totalExpense') / div,
      netMargin: sumField('netMargin'),
      netMarginPerAcre: sumField('netMargin') / div,
      breakEvenPerAcre: sumField('totalExpense') / div,
    };

    res.json({ fiscalYear, buSummaries, consolidated });
  } catch (err) {
    log.error('BU summary error', err);
    next(err);
  }
});

export default router;
