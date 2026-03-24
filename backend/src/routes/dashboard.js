import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { parseYear } from '../utils/fiscalYear.js';
import { calculateForecast } from '../services/forecastService.js';
import { getExecutiveDashboard } from '../services/agronomyService.js';
import { getDashboard as getLabourDashboard } from '../services/labourService.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('dashboard');
const router = Router();

router.get('/:farmId/dashboard/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const assumption = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
    });

    const totalAcres = assumption?.total_acres || 1;
    const crops = assumption?.crops_json || [];

    // Get accounting data aggregated
    const accountingData = await prisma.monthlyData.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
    });

    const agg = {};
    for (const row of accountingData) {
      for (const [key, val] of Object.entries(row.data_json || {})) {
        agg[key] = (agg[key] || 0) + val;
      }
    }

    // Get frozen budget for inputs adherence comparison
    const frozenData = await prisma.monthlyDataFrozen.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
    });
    let frozenInputsTotal = 0;
    for (const row of frozenData) {
      frozenInputsTotal += (row.data_json?.inputs || 0);
    }

    // Calculate KPIs using new category codes (expense-focused)
    const totalInputs = agg['inputs'] || 0;
    const totalLpm = agg['lpm'] || agg['variable_costs'] || 0;
    const totalLbf = agg['lbf'] || agg['fixed_costs'] || 0;
    const totalInsurance = agg['insurance'] || 0;
    const totalExpense = totalInputs + totalLpm + totalLbf + totalInsurance;
    const expensePerAcre = totalExpense / totalAcres;

    // Inputs adherence: compare actual inputs to frozen budget inputs
    const inputsAdherence = frozenInputsTotal > 0
      ? Math.min(100, (1 - Math.abs(totalInputs - frozenInputsTotal) / frozenInputsTotal) * 100)
      : 0;

    // Labour cost: use new lpm_personnel or fallback to old codes
    const labourCost = agg['lpm_personnel'] || ((agg['vc_variable_labour'] || 0) + (agg['fc_fixed_labour'] || 0));
    const labourCostPerAcre = labourCost / totalAcres;

    // Yield vs Target: use actual yield data from crops_json if available
    const targetRevenue = crops.reduce((sum, c) => sum + ((c.acres || 0) * (c.target_yield || 0) * (c.price_per_unit || 0)), 0);
    const actualRevenue = crops.reduce((sum, c) => sum + ((c.actual_acres || 0) * (c.actual_yield || 0) * (c.actual_price || 0)), 0);
    const yieldPct = targetRevenue > 0 ? (actualRevenue / targetRevenue) * 100 : 0;

    const kpis = [
      { label: 'Yield vs Target', value: yieldPct, unit: '%', gauge: true, target: 100, color: '#4caf50' },
      { label: 'Inputs Adherence', value: inputsAdherence, unit: '%', gauge: true, target: 100, color: '#2196f3' },
      { label: 'Total Expense/Acre', value: expensePerAcre, unit: '$/ac', gauge: false, color: '#00bcd4' },
      { label: 'Labour Cost/Acre', value: labourCostPerAcre, unit: '$/ac', gauge: false, color: '#ff9800' },
      { label: 'Total Expenses', value: totalExpense, unit: '$', gauge: false, color: '#f44336' },
      { label: 'Inputs Total', value: totalInputs, unit: '$', gauge: false, color: '#9c27b0' },
    ];

    // Budget vs Forecast chart data - expense categories only
    let chartData = { labels: [], budget: [], forecast: [] };
    try {
      const forecast = await calculateForecast(farmId, fiscalYear);
      const majorCategories = ['inputs', 'lpm', 'lbf', 'insurance'];
      const labelMap = {
        inputs: 'Inputs', lpm: 'LPM', lbf: 'LBF', insurance: 'Insurance',
      };
      chartData = {
        labels: majorCategories.map(c => labelMap[c] || c),
        budget: majorCategories.map(c => forecast[c]?.frozenBudgetTotal || 0),
        forecast: majorCategories.map(c => forecast[c]?.forecastTotal || 0),
      };
    } catch {
      // No forecast data available
    }

    // Per-crop yield KPIs using actual fields from crops_json
    const cropYields = crops.map(crop => {
      const actualYield = crop.actual_yield || 0;
      const yieldPctCrop = crop.target_yield > 0 ? (actualYield / crop.target_yield) * 100 : 0;

      return {
        name: crop.name,
        acres: crop.acres || 0,
        targetYield: crop.target_yield || 0,
        actualYield: Math.round(actualYield * 10) / 10,
        actualAcres: crop.actual_acres || 0,
        actualPrice: crop.actual_price || 0,
        yieldPct: Math.round(yieldPctCrop * 10) / 10,
      };
    });

    res.json({ kpis, chartData, cropYields });
  } catch (err) {
    next(err);
  }
});

// V2 — Farm Manager Performance Scorecard
router.get('/:farmId/dashboard/v2/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const [assumption, forecast, agroDashboard, latestCount] = await Promise.all([
      prisma.assumption.findUnique({
        where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
      }),
      calculateForecast(farmId, fiscalYear).catch(() => null),
      getExecutiveDashboard(farmId, fiscalYear).catch(() => null),
      prisma.countSubmission.findFirst({
        where: { farm_id: farmId },
        orderBy: { updated_at: 'desc' },
      }),
    ]);

    const totalAcres = assumption?.total_acres || 0;
    const crops = assumption?.crops_json || [];
    const hasFrozenBudget = forecast ? Object.values(forecast).some(c => c.frozenBudgetTotal) : false;

    // --- Scorecard ---
    const cropCount = crops.length;
    const agroPlanStatus = agroDashboard?.plan_status || null;

    // Input adherence: agro plan budget vs forecast actuals for inputs
    const inputsBudgetPerAcre = agroDashboard?.farm?.cost_per_acre || 0;
    const inputsForecastPerAcre = totalAcres > 0 && forecast?.inputs
      ? forecast.inputs.forecastTotal / totalAcres : 0;
    const inputAdherencePct = inputsBudgetPerAcre > 0
      ? Math.round((1 - Math.abs(inputsForecastPerAcre - inputsBudgetPerAcre) / inputsBudgetPerAcre) * 100)
      : null;

    // Controllable costs: fog + repairs + shop
    const controllableCodes = ['lpm_fog', 'lpm_repairs', 'lpm_shop'];
    const controllableActual = controllableCodes.reduce(
      (sum, code) => sum + (forecast?.[code]?.forecastTotal || 0), 0
    );
    const controllableBudget = controllableCodes.reduce(
      (sum, code) => sum + (forecast?.[code]?.frozenBudgetTotal || 0), 0
    );
    const controllablePerAcre = totalAcres > 0 ? controllableActual / totalAcres : 0;
    const controllableBudgetPerAcre = totalAcres > 0 ? controllableBudget / totalAcres : 0;

    // Inventory freshness
    let lastCountDaysAgo = null;
    let countStatus = null;
    if (latestCount) {
      const diffMs = Date.now() - new Date(latestCount.updated_at).getTime();
      lastCountDaysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      countStatus = lastCountDaysAgo <= 14 ? 'current' : lastCountDaysAgo <= 30 ? 'warning' : 'overdue';
    }

    // --- Expenses ---
    const buildRow = (code, name) => {
      const cat = forecast?.[code];
      const actual = cat?.forecastTotal || 0;
      const budget = cat?.frozenBudgetTotal || 0;
      return {
        code,
        name,
        budget_per_acre: totalAcres > 0 ? budget / totalAcres : 0,
        actual_per_acre: totalAcres > 0 ? actual / totalAcres : 0,
        variance: totalAcres > 0 ? (actual - budget) / totalAcres : 0,
      };
    };

    const controllableRows = [
      buildRow('inputs', 'Inputs (Seed/Fert/Chem)'),
      buildRow('lpm_fog', 'Fuel, Oil & Grease'),
      buildRow('lpm_repairs', 'Equipment Repairs'),
      buildRow('lpm_shop', 'Shop & Supplies'),
    ];
    const controllableTotal = {
      budget_per_acre: controllableRows.reduce((s, r) => s + r.budget_per_acre, 0),
      actual_per_acre: controllableRows.reduce((s, r) => s + r.actual_per_acre, 0),
      variance: controllableRows.reduce((s, r) => s + r.variance, 0),
    };

    const otherRows = [
      buildRow('lpm_personnel', 'Personnel (Labour)'),
      buildRow('lbf', 'Land Rent & Interest'),
      buildRow('insurance', 'Insurance'),
    ];
    const grandTotal = {
      budget_per_acre: controllableTotal.budget_per_acre + otherRows.reduce((s, r) => s + r.budget_per_acre, 0),
      actual_per_acre: controllableTotal.actual_per_acre + otherRows.reduce((s, r) => s + r.actual_per_acre, 0),
      variance: controllableTotal.variance + otherRows.reduce((s, r) => s + r.variance, 0),
    };

    // --- Crop Plan ---
    const cropPlanCrops = agroDashboard?.crops?.map(c => ({
      crop: c.crop,
      acres: c.acres,
      input_per_acre: c.total_per_acre || 0,
      pct_of_farm: totalAcres > 0 ? Math.round((c.acres / totalAcres) * 100) : 0,
    })) || [];

    res.json({
      scorecard: {
        total_acres: totalAcres,
        crop_count: cropCount,
        agro_plan_status: agroPlanStatus,
        input_adherence_pct: inputAdherencePct,
        input_actual_per_acre: Math.round(inputsForecastPerAcre),
        input_budget_per_acre: Math.round(inputsBudgetPerAcre),
        controllable_per_acre: Math.round(controllablePerAcre),
        controllable_budget_per_acre: Math.round(controllableBudgetPerAcre),
        last_count_days_ago: lastCountDaysAgo,
        count_status: countStatus,
      },
      expenses: {
        has_frozen_budget: hasFrozenBudget,
        controllable: controllableRows,
        controllable_total: controllableTotal,
        other: otherRows,
        grand_total: grandTotal,
      },
      cropPlan: {
        status: agroPlanStatus,
        crops: cropPlanCrops,
      },
    });
  } catch (err) {
    logger.error('Dashboard v2 error:', err);
    next(err);
  }
});

// V3 — Two Books Dashboard (Plan vs Actual)
router.get('/:farmId/dashboard/v3/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const { calculateVariance } = await import('../services/varianceService.js');

    const [assumption, variance, agroDashboard, labourDashboard] = await Promise.all([
      prisma.assumption.findUnique({
        where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
      }),
      calculateVariance(farmId, fiscalYear),
      getExecutiveDashboard(farmId, fiscalYear).catch(() => null),
      getLabourDashboard(farmId, fiscalYear).catch(() => null),
    ]);

    const totalAcres = assumption?.total_acres || 0;
    const crops = assumption?.crops_json || [];
    const divisor = totalAcres || 1;

    // KPI summary
    const planPerAcre = variance.planGrandTotal / divisor;
    const actualPerAcre = variance.actualGrandTotal / divisor;
    const variancePerAcre = variance.totalVariance / divisor;

    // Input plan breakdown (seed/fert/chem from plan data)
    const inputCategories = variance.byCategory.filter(c =>
      ['input_seed', 'input_fert', 'input_chem'].includes(c.code)
    );

    // Crop plan from agronomy
    const cropPlan = agroDashboard?.crops?.map(c => ({
      crop: c.crop,
      acres: c.acres,
      input_per_acre: c.total_per_acre || 0,
      pct_of_farm: totalAcres > 0 ? Math.round((c.acres / totalAcres) * 100) : 0,
    })) || [];

    // Monthly plan vs actual trend (for chart)
    const months = variance.months || [];
    const monthlyTrend = months.map(month => {
      let planMonth = 0;
      let actualMonth = 0;
      for (const cat of variance.byCategory.filter(c => ['inputs', 'lpm', 'lbf', 'insurance'].includes(c.code))) {
        planMonth += cat.planMonths?.[month] || 0;
        actualMonth += cat.actualMonths?.[month] || 0;
      }
      return { month, plan: planMonth, actual: actualMonth };
    });

    res.json({
      totalAcres,
      cropCount: crops.length,
      planPerAcre: Math.round(planPerAcre),
      actualPerAcre: Math.round(actualPerAcre),
      variancePerAcre: Math.round(variancePerAcre),
      variancePct: variance.totalPctDiff,
      planTotal: variance.planGrandTotal,
      actualTotal: variance.actualGrandTotal,
      varianceTotal: variance.totalVariance,
      hasActuals: variance.hasActuals,
      waterfall: variance.waterfall,
      inputBreakdown: inputCategories.map(c => ({
        code: c.code,
        name: c.display_name,
        planTotal: c.planTotal,
        planPerAcre: c.planTotal / divisor,
      })),
      cropPlan,
      agroPlanStatus: agroDashboard?.plan_status || null,
      monthlyTrend,
      // Labour & fuel plan vs actual
      labour: labourDashboard ? {
        totalHours: labourDashboard.total_hours,
        avgWage: labourDashboard.avg_wage,
        planCost: labourDashboard.total_cost,
        planCostPerAcre: labourDashboard.cost_per_acre,
        hoursPerAcre: labourDashboard.hours_per_acre,
        actualCost: variance.byCategory.find(c => c.code === 'lpm_personnel')?.actualTotal || 0,
        actualCostPerAcre: (variance.byCategory.find(c => c.code === 'lpm_personnel')?.actualTotal || 0) / divisor,
        seasons: labourDashboard.seasons,
      } : null,
      fuel: labourDashboard ? {
        planCost: labourDashboard.total_fuel_cost,
        planCostPerAcre: labourDashboard.fuel_rate_per_acre || (labourDashboard.total_fuel_cost / divisor),
        fuelCostPerLitre: labourDashboard.fuel_cost_per_litre,
        totalLitres: labourDashboard.total_fuel_litres,
        litresPerAcre: labourDashboard.litres_per_acre,
        actualCost: variance.byCategory.find(c => c.code === 'lpm_fog')?.actualTotal || 0,
        actualCostPerAcre: (variance.byCategory.find(c => c.code === 'lpm_fog')?.actualTotal || 0) / divisor,
      } : null,
    });
  } catch (err) {
    logger.error('Dashboard v3 error:', err);
    next(err);
  }
});

export default router;
