import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { updatePerUnitCell, updateAccountingCell } from '../services/calculationService.js';
import { getFarmCategories, getFarmLeafCategories, recalcParentSums } from '../services/categoryService.js';
import { broadcastCellChange } from '../socket/handler.js';
import { emitDataChange, aiEvents } from '../socket/aiEvents.js';
import { generateFiscalMonths, parseYear, isValidMonth } from '../utils/fiscalYear.js';
import { validateBody } from '../middleware/validation.js';

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

    const [monthlyData, frozenData, priorYearData, actualMonths] = await Promise.all([
      prisma.monthlyData.findMany({
        where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'per_unit' },
        orderBy: { month: 'asc' },
      }),
      prisma.monthlyDataFrozen.findMany({
        where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'per_unit' },
      }),
      prisma.monthlyData.findMany({
        where: { farm_id: farmId, fiscal_year: fiscalYear - 1, type: 'per_unit' },
      }),
      // Check which months have actuals available (Book 2)
      prisma.monthlyActual.findMany({
        where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'per_unit' },
        select: { month: true },
      }),
    ]);

    // Build hasActuals map for frontend indicator
    const hasActualsSet = new Set(actualMonths.map(r => r.month));

    // Build month map
    const monthMap = {};
    for (const row of monthlyData) {
      monthMap[row.month] = { data: row.data_json || {}, comments: row.comments_json || {} };
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
    const allRows = farmCategories.map(cat => {
      const monthValues = {};
      const monthActuals = {};
      const monthComments = {};
      let currentAgg = 0;

      for (const month of months) {
        const val = monthMap[month]?.data?.[cat.code] || 0;
        monthValues[month] = val;
        monthActuals[month] = hasActualsSet.has(month);
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

    // Filter to expense-only categories (exclude revenue and its children)
    const rows = allRows.filter(r => {
      if (r.code === 'revenue' || r.parent_code === 'revenue') return false;
      if (r.code?.startsWith('rev_')) return false;
      return true;
    });

    // Compute Total Expense row from expense parent categories
    const expenseParentRows = rows.filter(r => ['inputs', 'lpm', 'lbf', 'insurance'].includes(r.code));

    if (expenseParentRows.length > 0) {
      const totalExpMonths = {};
      let totalExpAgg = 0;
      for (const month of months) {
        const val = expenseParentRows.reduce((sum, r) => sum + (r.months[month] || 0), 0);
        totalExpMonths[month] = val;
        totalExpAgg += val;
      }

      const totalExpForecast = expenseParentRows.reduce((sum, r) => sum + (r.forecastTotal || 0), 0);
      const totalExpFrozen = expenseParentRows.reduce((sum, r) => sum + (r.frozenBudgetTotal || 0), 0);

      const firstRow = rows[0];
      rows.push({
        code: '_total_expense',
        display_name: 'Total Expense',
        level: -1,
        parent_code: null,
        category_type: 'COMPUTED',
        sort_order: 998,
        priorYear: expenseParentRows.reduce((sum, r) => sum + (r.priorYear || 0), 0),
        months: totalExpMonths,
        actuals: firstRow?.actuals || {},
        comments: {},
        isComputed: true,
        currentAggregate: totalExpAgg,
        forecastTotal: totalExpForecast,
        frozenBudgetTotal: totalExpFrozen,
        variance: totalExpForecast - totalExpFrozen,
        pctDiff: totalExpFrozen !== 0 ? ((totalExpForecast - totalExpFrozen) / Math.abs(totalExpFrozen)) * 100 : 0,
      });
    }

    res.json({ fiscalYear, startMonth, months, rows, isFrozen: assumption?.is_frozen || false });
  } catch (err) {
    next(err);
  }
});

// PATCH per-unit cell
router.patch('/:farmId/per-unit/:year/:month', authenticate, requireRole('admin', 'manager'),
  validateBody({ category_code: { required: true, type: 'string' }, value: { required: true, type: 'number' } }),
  async (req, res, next) => {
  try {
    const { farmId, year, month } = req.params;
    const { category_code, value, comment } = req.body;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });
    if (!isValidMonth(month)) return res.status(400).json({ error: 'Invalid month' });

    // Only allow editing leaf categories
    const leafCategories = await getFarmLeafCategories(farmId);
    const isLeaf = leafCategories.some(c => c.code === category_code);
    if (!isLeaf) {
      return res.status(400).json({ error: 'Cannot edit parent category directly' });
    }

    // Plan is always editable (Two Books architecture — actuals live in MonthlyActual)
    // Tag as 'Manual' when user edits directly (module pushes pass their own comment)
    const effectiveComment = comment !== undefined ? comment : 'Manual';
    const result = await updatePerUnitCell(farmId, fiscalYear, month, category_code, parseFloat(value), effectiveComment);

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
      emitDataChange(io, farmId, aiEvents.cellEdit('per_unit', month, category_code, null, value));
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

    const [monthlyData, priorYearData, acctActualMonths] = await Promise.all([
      prisma.monthlyData.findMany({
        where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
      }),
      prisma.monthlyData.findMany({
        where: { farm_id: farmId, fiscal_year: fiscalYear - 1, type: 'accounting' },
      }),
      // Check which months have actuals available (Book 2)
      prisma.monthlyActual.findMany({
        where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
        select: { month: true },
      }),
    ]);

    const acctHasActualsSet = new Set(acctActualMonths.map(r => r.month));

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
    const monthCommentsMap = {};
    for (const row of monthlyData) {
      monthMap[row.month] = row.data_json || {};
      monthCommentsMap[row.month] = row.comments_json || {};
    }

    const isFrozen = assumption?.is_frozen || false;

    const allRows = farmCategories.map(cat => {
      const monthValues = {};
      const actuals = {};
      const comments = {};
      let total = 0;
      for (const month of months) {
        const val = monthMap[month]?.[cat.code] || 0;
        monthValues[month] = val;
        actuals[month] = acctHasActualsSet.has(month);
        comments[month] = monthCommentsMap[month]?.[cat.code] || '';
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
        comments,
        total,
        priorYear: priorYearAgg[cat.code] || 0,
        forecastTotal: forecastVal,
        frozenBudgetTotal: budgetVal,
        variance: varianceVal,
        pctDiff: pctDiffVal,
      };
    });

    // Filter to expense-only categories (exclude revenue and its children)
    const rows = allRows.filter(r => {
      if (r.code === 'revenue' || r.parent_code === 'revenue') return false;
      if (r.code?.startsWith('rev_')) return false;
      return true;
    });

    // Compute summary and Total Expense computed row
    const expenseParentRows = rows.filter(r => ['inputs', 'lpm', 'lbf', 'insurance'].includes(r.code));

    const summaryByMonth = {};
    for (const month of months) {
      const totalExpense = expenseParentRows.reduce((sum, r) => sum + (monthMap[month]?.[r.code] || 0), 0);
      summaryByMonth[month] = { totalExpense };
    }

    if (expenseParentRows.length > 0) {
      const totalExpMonths = {};
      let totalExpTotal = 0;
      for (const month of months) {
        const val = expenseParentRows.reduce((sum, r) => sum + (r.months[month] || 0), 0);
        totalExpMonths[month] = val;
        totalExpTotal += val;
      }

      const totalExpForecast = expenseParentRows.reduce((sum, r) => sum + (r.forecastTotal || 0), 0);
      const totalExpBudget = expenseParentRows.reduce((sum, r) => sum + (r.frozenBudgetTotal || 0), 0);
      const totalExpVariance = totalExpForecast - totalExpBudget;
      const totalExpPctDiff = totalExpBudget !== 0 ? (totalExpVariance / Math.abs(totalExpBudget)) * 100 : 0;

      const firstRow = rows[0];
      rows.push({
        code: '_total_expense',
        display_name: 'Total Expense',
        level: -1,
        parent_code: null,
        category_type: 'COMPUTED',
        sort_order: 998,
        months: totalExpMonths,
        actuals: firstRow?.actuals || {},
        total: totalExpTotal,
        priorYear: expenseParentRows.reduce((sum, r) => sum + (r.priorYear || 0), 0),
        isComputed: true,
        forecastTotal: totalExpForecast,
        frozenBudgetTotal: totalExpBudget,
        variance: totalExpVariance,
        pctDiff: totalExpPctDiff,
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
router.patch('/:farmId/accounting/:year/:month', authenticate, requireRole('admin', 'manager'),
  validateBody({ category_code: { required: true, type: 'string' }, value: { required: true, type: 'number' } }),
  async (req, res, next) => {
  try {
    const { farmId, year, month } = req.params;
    const { category_code, value } = req.body;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });
    if (!isValidMonth(month)) return res.status(400).json({ error: 'Invalid month' });

    // Only allow editing leaf categories
    const leafCategories = await getFarmLeafCategories(farmId);
    const isLeaf = leafCategories.some(c => c.code === category_code);
    if (!isLeaf) {
      return res.status(400).json({ error: 'Cannot edit parent category directly' });
    }

    // Plan is always editable (Two Books architecture — actuals live in MonthlyActual)
    // Tag as 'Manual' when user edits directly
    const result = await updateAccountingCell(farmId, fiscalYear, month, category_code, parseFloat(value), 'Manual');

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
      emitDataChange(io, farmId, aiEvents.cellEdit('accounting', month, category_code, null, value));
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST manual actual entry (QB fallback / bulk)
router.post('/:farmId/financial/manual-actual', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { fiscal_year, month, data } = req.body;

    if (!fiscal_year || !month || !data) {
      return res.status(400).json({ error: 'fiscal_year, month, and data are required' });
    }

    const farmCategories = await getFarmCategories(farmId);

    // Write to MonthlyActual (Book 2: Actual P&L) — NOT MonthlyData (Book 1: Plan)
    const existing = await prisma.monthlyActual.findUnique({
      where: {
        farm_id_fiscal_year_month_type: {
          farm_id: farmId, fiscal_year: parseInt(fiscal_year), month, type: 'accounting',
        },
      },
    });

    const currentData = existing?.data_json || {};
    const merged = { ...currentData, ...data };
    const withParents = recalcParentSums(merged, farmCategories);

    await prisma.monthlyActual.upsert({
      where: {
        farm_id_fiscal_year_month_type: {
          farm_id: farmId, fiscal_year: parseInt(fiscal_year), month, type: 'accounting',
        },
      },
      update: { data_json: withParents },
      create: {
        farm_id: farmId, fiscal_year: parseInt(fiscal_year), month, type: 'accounting',
        data_json: withParents, basis: 'cash', source: 'manual',
      },
    });

    // Recalc per-unit actuals
    const assumption = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: parseInt(fiscal_year) } },
    });
    const totalAcres = assumption?.total_acres || 1;
    const perUnitData = {};
    for (const [key, val] of Object.entries(withParents)) {
      perUnitData[key] = val / totalAcres;
    }

    await prisma.monthlyActual.upsert({
      where: {
        farm_id_fiscal_year_month_type: {
          farm_id: farmId, fiscal_year: parseInt(fiscal_year), month, type: 'per_unit',
        },
      },
      update: { data_json: perUnitData },
      create: {
        farm_id: farmId, fiscal_year: parseInt(fiscal_year), month, type: 'per_unit',
        data_json: perUnitData, basis: 'cash', source: 'manual',
      },
    });

    const io = req.app.get('io');
    if (io) {
      broadcastCellChange(io, farmId, {
        fiscalYear: parseInt(fiscal_year),
        month,
        perUnitData,
        accountingData: withParents,
      });
    }

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

// GET actuals data (Book 2: Actual P&L from QB imports)
router.get('/:farmId/actuals/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const fiscalYear = parseYear(req.params.year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const assumption = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
    });
    const months = generateFiscalMonths(assumption?.start_month || 'Nov');
    const totalAcres = assumption?.total_acres || 0;
    const farmCategories = await getFarmCategories(farmId);

    const [acctData, puData] = await Promise.all([
      prisma.monthlyActual.findMany({
        where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
      }),
      prisma.monthlyActual.findMany({
        where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'per_unit' },
      }),
    ]);

    const acctMap = {};
    for (const row of acctData) acctMap[row.month] = row.data_json || {};
    const puMap = {};
    for (const row of puData) puMap[row.month] = row.data_json || {};

    const rows = farmCategories
      .filter(c => c.category_type !== 'REVENUE' && !c.code?.startsWith('rev_'))
      .map(cat => {
        const monthValues = {};
        let total = 0;
        for (const month of months) {
          const val = acctMap[month]?.[cat.code] || 0;
          monthValues[month] = val;
          total += val;
        }
        return {
          code: cat.code,
          display_name: cat.display_name,
          level: cat.level,
          category_type: cat.category_type,
          sort_order: cat.sort_order,
          months: monthValues,
          total,
        };
      })
      .sort((a, b) => a.sort_order - b.sort_order);

    res.json({ fiscalYear, months, totalAcres, rows });
  } catch (err) {
    next(err);
  }
});

// GET variance (Plan vs Actual)
router.get('/:farmId/variance/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const fiscalYear = parseYear(req.params.year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const { calculateVariance } = await import('../services/varianceService.js');
    const variance = await calculateVariance(farmId, fiscalYear);
    res.json(variance);
  } catch (err) {
    next(err);
  }
});

export default router;
