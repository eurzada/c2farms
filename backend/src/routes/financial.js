import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { updatePerUnitCell, updateAccountingCell } from '../services/calculationService.js';
import { getFarmCategories, getFarmLeafCategories, recalcParentSums } from '../services/categoryService.js';
import { broadcastCellChange } from '../socket/handler.js';
import { generateFiscalMonths, parseYear, isValidMonth } from '../utils/fiscalYear.js';

const router = Router();

// GET categories for a farm
router.get('/:farmId/categories', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const categories = await getFarmCategories(farmId);
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

// GET per-unit data for all 12 months
router.get('/:farmId/per-unit/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const assumption = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
    });

    const startMonth = assumption?.start_month || 'Nov';
    const months = generateFiscalMonths(startMonth);

    const farmCategories = await getFarmCategories(farmId);

    const monthlyData = await prisma.monthlyData.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'per_unit' },
      orderBy: { month: 'asc' },
    });

    // Get frozen budget for comparison
    const frozenData = await prisma.monthlyDataFrozen.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'per_unit' },
    });

    // Get prior year data (aggregate)
    const priorYearData = await prisma.monthlyData.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear - 1, type: 'per_unit' },
    });

    // Build month map
    const monthMap = {};
    for (const row of monthlyData) {
      monthMap[row.month] = { data: row.data_json || {}, isActual: row.is_actual, comments: row.comments_json || {} };
    }

    const frozenMap = {};
    for (const row of frozenData) {
      frozenMap[row.month] = row.data_json || {};
    }

    // Aggregate prior year
    const priorYearAgg = {};
    for (const row of priorYearData) {
      for (const [key, val] of Object.entries(row.data_json || {})) {
        priorYearAgg[key] = (priorYearAgg[key] || 0) + val;
      }
    }

    const isFrozenPU = assumption?.is_frozen || false;

    // Build response rows per category
    const rows = farmCategories.map(cat => {
      const monthValues = {};
      const monthActuals = {};
      const monthComments = {};
      let currentAgg = 0;

      for (const month of months) {
        const val = monthMap[month]?.data?.[cat.code] || 0;
        monthValues[month] = val;
        monthActuals[month] = monthMap[month]?.isActual || false;
        monthComments[month] = monthMap[month]?.comments?.[cat.code] || '';
        currentAgg += val;
      }

      // Compute frozen budget total from frozenMap
      let frozenBudgetSum = 0;
      for (const month of months) {
        frozenBudgetSum += frozenMap[month]?.[cat.code] || 0;
      }

      const forecastVal = currentAgg;
      const budgetVal = isFrozenPU ? frozenBudgetSum : currentAgg;
      const varianceVal = forecastVal - budgetVal;
      const pctDiffVal = budgetVal !== 0 ? (varianceVal / Math.abs(budgetVal)) * 100 : 0;

      return {
        code: cat.code,
        display_name: cat.display_name,
        level: cat.level,
        parent_code: cat.parent_id
          ? farmCategories.find(c => c.id === cat.parent_id)?.code || null
          : null,
        category_type: cat.category_type,
        sort_order: cat.sort_order,
        priorYear: priorYearAgg[cat.code] || 0,
        months: monthValues,
        actuals: monthActuals,
        comments: monthComments,
        currentAggregate: currentAgg,
        forecastTotal: forecastVal,
        frozenBudgetTotal: budgetVal,
        variance: varianceVal,
        pctDiff: pctDiffVal,
      };
    });

    // Compute profit row: revenue - all expenses
    const revenueRow = rows.find(r => r.code === 'revenue');
    const inputsRow = rows.find(r => r.code === 'inputs');
    const lpmRow = rows.find(r => r.code === 'lpm');
    const lbfRow = rows.find(r => r.code === 'lbf');
    const insuranceRow = rows.find(r => r.code === 'insurance');

    const expenseRows = [inputsRow, lpmRow, lbfRow, insuranceRow].filter(Boolean);

    if (revenueRow && expenseRows.length > 0) {
      // Total Expense computed row
      const totalExpMonths = {};
      let totalExpAgg = 0;
      for (const month of months) {
        const val = expenseRows.reduce((sum, r) => sum + (r.months[month] || 0), 0);
        totalExpMonths[month] = val;
        totalExpAgg += val;
      }

      const totalExpForecast = expenseRows.reduce((sum, r) => sum + (r.forecastTotal || 0), 0);
      const totalExpFrozen = expenseRows.reduce((sum, r) => sum + (r.frozenBudgetTotal || 0), 0);

      rows.push({
        code: '_total_expense',
        display_name: 'Total Expense',
        level: -1,
        parent_code: null,
        category_type: 'COMPUTED',
        sort_order: 998,
        priorYear: expenseRows.reduce((sum, r) => sum + (r.priorYear || 0), 0),
        months: totalExpMonths,
        actuals: revenueRow.actuals,
        comments: {},
        isComputed: true,
        currentAggregate: totalExpAgg,
        forecastTotal: totalExpForecast,
        frozenBudgetTotal: totalExpFrozen,
        variance: totalExpForecast - totalExpFrozen,
        pctDiff: totalExpFrozen !== 0 ? ((totalExpForecast - totalExpFrozen) / Math.abs(totalExpFrozen)) * 100 : 0,
      });

      // Profit computed row
      const profitMonths = {};
      let profitAgg = 0;
      for (const month of months) {
        const val = (revenueRow.months[month] || 0) - (totalExpMonths[month] || 0);
        profitMonths[month] = val;
        profitAgg += val;
      }

      const profitForecast = (revenueRow.forecastTotal || 0) - totalExpForecast;
      const profitFrozen = (revenueRow.frozenBudgetTotal || 0) - totalExpFrozen;

      rows.push({
        code: '_profit',
        display_name: 'Profit',
        level: -1,
        parent_code: null,
        category_type: 'COMPUTED',
        sort_order: 999,
        priorYear: (revenueRow.priorYear || 0) - expenseRows.reduce((sum, r) => sum + (r.priorYear || 0), 0),
        months: profitMonths,
        actuals: revenueRow.actuals,
        comments: {},
        isComputed: true,
        currentAggregate: profitAgg,
        forecastTotal: profitForecast,
        frozenBudgetTotal: profitFrozen,
        variance: profitForecast - profitFrozen,
        pctDiff: profitFrozen !== 0 ? ((profitForecast - profitFrozen) / Math.abs(profitFrozen)) * 100 : 0,
      });
    }

    res.json({ fiscalYear, startMonth, months, rows, isFrozen: assumption?.is_frozen || false });
  } catch (err) {
    next(err);
  }
});

// PATCH per-unit cell
router.patch('/:farmId/per-unit/:year/:month', authenticate, async (req, res, next) => {
  try {
    const { farmId, year, month } = req.params;
    const { category_code, value, comment } = req.body;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });
    if (!isValidMonth(month)) return res.status(400).json({ error: 'Invalid month' });

    if (!category_code || value === undefined) {
      return res.status(400).json({ error: 'category_code and value are required' });
    }

    // Only allow editing leaf categories
    const leafCategories = await getFarmLeafCategories(farmId);
    const isLeaf = leafCategories.some(c => c.code === category_code);
    if (!isLeaf) {
      return res.status(400).json({ error: 'Cannot edit parent category directly' });
    }

    // Check if month is locked (actual data)
    const existing = await prisma.monthlyData.findUnique({
      where: {
        farm_id_fiscal_year_month_type: {
          farm_id: farmId, fiscal_year: fiscalYear, month, type: 'per_unit',
        },
      },
    });

    if (existing?.is_actual) {
      return res.status(403).json({ error: 'Cannot edit actual data. Month is locked.' });
    }

    const result = await updatePerUnitCell(farmId, fiscalYear, month, category_code, parseFloat(value), comment);

    // Broadcast via socket
    const io = req.app.get('io');
    if (io) {
      broadcastCellChange(io, farmId, {
        fiscalYear,
        month,
        categoryCode: category_code,
        perUnitValue: result.perUnit[category_code],
        accountingValue: result.accounting[category_code],
        perUnitData: result.perUnit,
        accountingData: result.accounting,
      });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET accounting data for all 12 months
router.get('/:farmId/accounting/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const assumption = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
    });

    const startMonth = assumption?.start_month || 'Nov';
    const months = generateFiscalMonths(startMonth);
    const totalAcres = assumption?.total_acres || 0;

    const farmCategories = await getFarmCategories(farmId);

    const monthlyData = await prisma.monthlyData.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
    });

    // Get prior year accounting data
    const priorYearData = await prisma.monthlyData.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear - 1, type: 'accounting' },
    });

    const priorYearAgg = {};
    for (const row of priorYearData) {
      for (const [key, val] of Object.entries(row.data_json || {})) {
        priorYearAgg[key] = (priorYearAgg[key] || 0) + val;
      }
    }

    // Get frozen budget data for accounting
    const frozenData = await prisma.monthlyDataFrozen.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
    });

    const acctFrozenMap = {};
    for (const row of frozenData) {
      acctFrozenMap[row.month] = row.data_json || {};
    }

    const monthMap = {};
    const monthActualMap = {};
    for (const row of monthlyData) {
      monthMap[row.month] = row.data_json || {};
      monthActualMap[row.month] = row.is_actual || false;
    }

    const isFrozen = assumption?.is_frozen || false;

    const rows = farmCategories.map(cat => {
      const monthValues = {};
      const actuals = {};
      let total = 0;
      for (const month of months) {
        const val = monthMap[month]?.[cat.code] || 0;
        monthValues[month] = val;
        actuals[month] = monthActualMap[month] || false;
        total += val;
      }

      // Compute frozen budget total from frozen accounting data
      let frozenBudgetSum = 0;
      for (const month of months) {
        frozenBudgetSum += acctFrozenMap[month]?.[cat.code] || 0;
      }

      const forecastVal = total;
      const budgetVal = isFrozen ? frozenBudgetSum : total;
      const varianceVal = forecastVal - budgetVal;
      const pctDiffVal = budgetVal !== 0 ? (varianceVal / Math.abs(budgetVal)) * 100 : 0;

      return {
        code: cat.code,
        display_name: cat.display_name,
        level: cat.level,
        parent_code: cat.parent_id
          ? farmCategories.find(c => c.id === cat.parent_id)?.code || null
          : null,
        category_type: cat.category_type,
        sort_order: cat.sort_order,
        months: monthValues,
        actuals,
        total,
        priorYear: priorYearAgg[cat.code] || 0,
        forecastTotal: forecastVal,
        frozenBudgetTotal: budgetVal,
        variance: varianceVal,
        pctDiff: pctDiffVal,
      };
    });

    // Compute summary and computed rows
    const revenueRow = rows.find(r => r.code === 'revenue');
    const inputsRow = rows.find(r => r.code === 'inputs');
    const lpmRow = rows.find(r => r.code === 'lpm');
    const lbfRow = rows.find(r => r.code === 'lbf');
    const insuranceRow = rows.find(r => r.code === 'insurance');

    const expenseRows = [inputsRow, lpmRow, lbfRow, insuranceRow].filter(Boolean);

    const summaryByMonth = {};
    for (const month of months) {
      const revenue = revenueRow ? (monthMap[month]?.[revenueRow.code] || 0) : 0;
      const totalExpense = expenseRows.reduce((sum, r) => sum + (monthMap[month]?.[r.code] || 0), 0);
      const profit = revenue - totalExpense;
      summaryByMonth[month] = { revenue, totalExpense, profit };
    }

    // Push computed rows (Total Expense, Profit) into rows for grid display
    if (revenueRow && expenseRows.length > 0) {
      const totalExpMonths = {};
      let totalExpTotal = 0;
      for (const month of months) {
        const val = expenseRows.reduce((sum, r) => sum + (r.months[month] || 0), 0);
        totalExpMonths[month] = val;
        totalExpTotal += val;
      }

      const totalExpForecast = expenseRows.reduce((sum, r) => sum + (r.forecastTotal || 0), 0);
      const totalExpBudget = expenseRows.reduce((sum, r) => sum + (r.frozenBudgetTotal || 0), 0);
      const totalExpVariance = totalExpForecast - totalExpBudget;
      const totalExpPctDiff = totalExpBudget !== 0 ? (totalExpVariance / Math.abs(totalExpBudget)) * 100 : 0;

      rows.push({
        code: '_total_expense',
        display_name: 'Total Expense',
        level: -1,
        parent_code: null,
        category_type: 'COMPUTED',
        sort_order: 998,
        months: totalExpMonths,
        actuals: revenueRow.actuals,
        total: totalExpTotal,
        priorYear: expenseRows.reduce((sum, r) => sum + (r.priorYear || 0), 0),
        isComputed: true,
        forecastTotal: totalExpForecast,
        frozenBudgetTotal: totalExpBudget,
        variance: totalExpVariance,
        pctDiff: totalExpPctDiff,
      });

      // Profit computed row
      const profitMonths = {};
      let profitTotal = 0;
      for (const month of months) {
        const val = (revenueRow.months[month] || 0) - (totalExpMonths[month] || 0);
        profitMonths[month] = val;
        profitTotal += val;
      }

      const profitForecast = (revenueRow.forecastTotal || 0) - totalExpForecast;
      const profitBudget = (revenueRow.frozenBudgetTotal || 0) - totalExpBudget;
      const profitVariance = profitForecast - profitBudget;
      const profitPctDiff = profitBudget !== 0 ? (profitVariance / Math.abs(profitBudget)) * 100 : 0;

      rows.push({
        code: '_profit',
        display_name: 'Profit',
        level: -1,
        parent_code: null,
        category_type: 'COMPUTED',
        sort_order: 999,
        months: profitMonths,
        actuals: revenueRow.actuals,
        total: profitTotal,
        priorYear: (revenueRow.priorYear || 0) - expenseRows.reduce((sum, r) => sum + (r.priorYear || 0), 0),
        isComputed: true,
        forecastTotal: profitForecast,
        frozenBudgetTotal: profitBudget,
        variance: profitVariance,
        pctDiff: profitPctDiff,
      });
    }

    res.json({
      fiscalYear,
      startMonth,
      totalAcres,
      months,
      rows,
      summary: summaryByMonth,
      isFrozen: assumption?.is_frozen || false,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH single accounting cell (used by AccountingGrid inline editing)
router.patch('/:farmId/accounting/:year/:month', authenticate, async (req, res, next) => {
  try {
    const { farmId, year, month } = req.params;
    const { category_code, value } = req.body;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });
    if (!isValidMonth(month)) return res.status(400).json({ error: 'Invalid month' });

    if (!category_code || value === undefined) {
      return res.status(400).json({ error: 'category_code and value are required' });
    }

    // Only allow editing leaf categories
    const leafCategories = await getFarmLeafCategories(farmId);
    const isLeaf = leafCategories.some(c => c.code === category_code);
    if (!isLeaf) {
      return res.status(400).json({ error: 'Cannot edit parent category directly' });
    }

    // Check if month is locked (actual data)
    const existing = await prisma.monthlyData.findUnique({
      where: {
        farm_id_fiscal_year_month_type: {
          farm_id: farmId, fiscal_year: fiscalYear, month, type: 'accounting',
        },
      },
    });

    if (existing?.is_actual) {
      return res.status(403).json({ error: 'Cannot edit actual data. Month is locked.' });
    }

    const result = await updateAccountingCell(farmId, fiscalYear, month, category_code, parseFloat(value));

    // Broadcast via socket
    const io = req.app.get('io');
    if (io) {
      broadcastCellChange(io, farmId, {
        fiscalYear,
        month,
        categoryCode: category_code,
        perUnitData: result.perUnit,
        accountingData: result.accounting,
      });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST manual actual entry (QB fallback / bulk)
router.post('/:farmId/financial/manual-actual', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { fiscal_year, month, data } = req.body;

    if (!fiscal_year || !month || !data) {
      return res.status(400).json({ error: 'fiscal_year, month, and data are required' });
    }

    const farmCategories = await getFarmCategories(farmId);

    // Update accounting data as actuals
    const existing = await prisma.monthlyData.findUnique({
      where: {
        farm_id_fiscal_year_month_type: {
          farm_id: farmId, fiscal_year: parseInt(fiscal_year), month, type: 'accounting',
        },
      },
    });

    const currentData = existing?.data_json || {};
    const merged = { ...currentData, ...data };
    const withParents = recalcParentSums(merged, farmCategories);

    await prisma.monthlyData.upsert({
      where: {
        farm_id_fiscal_year_month_type: {
          farm_id: farmId, fiscal_year: parseInt(fiscal_year), month, type: 'accounting',
        },
      },
      update: { data_json: withParents, is_actual: true },
      create: {
        farm_id: farmId, fiscal_year: parseInt(fiscal_year), month, type: 'accounting',
        data_json: withParents, is_actual: true, comments_json: {},
      },
    });

    // Recalc per-unit
    const assumption = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: parseInt(fiscal_year) } },
    });
    const totalAcres = assumption?.total_acres || 1;
    const perUnitData = {};
    for (const [key, val] of Object.entries(withParents)) {
      perUnitData[key] = val / totalAcres;
    }

    await prisma.monthlyData.upsert({
      where: {
        farm_id_fiscal_year_month_type: {
          farm_id: farmId, fiscal_year: parseInt(fiscal_year), month, type: 'per_unit',
        },
      },
      update: { data_json: perUnitData, is_actual: true },
      create: {
        farm_id: farmId, fiscal_year: parseInt(fiscal_year), month, type: 'per_unit',
        data_json: perUnitData, is_actual: true, comments_json: {},
      },
    });

    res.json({ message: 'Actuals saved', data: withParents });
  } catch (err) {
    next(err);
  }
});

// GET prior year aggregate
router.get('/:farmId/prior-year/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fy = parseYear(year);
    if (!fy) return res.status(400).json({ error: 'Invalid fiscal year' });
    const priorYear = fy - 1;

    const priorData = await prisma.monthlyData.findMany({
      where: { farm_id: farmId, fiscal_year: priorYear, type: 'per_unit' },
    });

    const aggregate = {};
    for (const row of priorData) {
      for (const [key, val] of Object.entries(row.data_json || {})) {
        aggregate[key] = (aggregate[key] || 0) + val;
      }
    }

    res.json({ fiscalYear: priorYear, aggregate });
  } catch (err) {
    next(err);
  }
});

export default router;
