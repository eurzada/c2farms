import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { parseYear } from '../utils/fiscalYear.js';
import { calculateForecast } from '../services/forecastService.js';

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

export default router;
