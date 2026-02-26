import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { generateFiscalMonths, CALENDAR_MONTHS, parseYear } from '../utils/fiscalYear.js';
import { LEAF_CATEGORIES } from '../utils/categories.js';
import { emitDataChange, aiEvents } from '../socket/aiEvents.js';

const router = Router();

// GET assumptions for a farm and fiscal year
router.get('/:farmId/assumptions/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const assumption = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
    });
    if (!assumption) {
      return res.status(404).json({ error: 'Assumptions not found for this year' });
    }
    res.json(assumption);
  } catch (err) {
    next(err);
  }
});

// CREATE or UPDATE assumptions
router.post('/:farmId/assumptions', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { fiscal_year, start_month, end_month, total_acres, crops, bins } = req.body;

    if (!fiscal_year || !total_acres) {
      return res.status(400).json({ error: 'fiscal_year and total_acres are required' });
    }

    // Validate crop acres
    if (crops && Array.isArray(crops)) {
      const cropAcresSum = crops.reduce((sum, c) => sum + (c.acres || 0), 0);
      if (cropAcresSum > total_acres) {
        return res.status(400).json({ error: 'Crop acres sum exceeds total acres' });
      }
    }

    const fy = parseInt(fiscal_year);
    const newAcres = parseFloat(total_acres);

    // Auto-compute end_month from start_month (month before start)
    const sm = start_month || 'Nov';
    const smIdx = CALENDAR_MONTHS.indexOf(sm);
    const computedEndMonth = CALENDAR_MONTHS[(smIdx + 11) % 12]; // month before start
    const fiscalMonths = generateFiscalMonths(sm);

    // Check if total_acres changed (for recalculation)
    const existingAssumption = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fy } },
    });
    const oldAcres = existingAssumption?.total_acres;

    const assumption = await prisma.assumption.upsert({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fy } },
      update: {
        start_month: sm,
        end_month: computedEndMonth,
        total_acres: newAcres,
        crops_json: crops || [],
        bins_json: bins || [],
      },
      create: {
        farm_id: farmId,
        fiscal_year: fy,
        start_month: sm,
        end_month: computedEndMonth,
        total_acres: newAcres,
        crops_json: crops || [],
        bins_json: bins || [],
      },
    });

    // Initialize monthly_data rows for all 12 months if they don't exist
    for (const month of fiscalMonths) {
      for (const type of ['per_unit', 'accounting']) {
        await prisma.monthlyData.upsert({
          where: {
            farm_id_fiscal_year_month_type: {
              farm_id: farmId,
              fiscal_year: fy,
              month,
              type,
            },
          },
          update: {},
          create: {
            farm_id: farmId,
            fiscal_year: fy,
            month,
            type,
            data_json: {},
            comments_json: {},
          },
        });
      }
    }

    // If total_acres changed, recalculate accounting data from per-unit (per_unit stays, accounting = per_unit * newAcres)
    if (oldAcres && oldAcres !== newAcres) {
      const perUnitRows = await prisma.monthlyData.findMany({
        where: { farm_id: farmId, fiscal_year: fy, type: 'per_unit' },
      });

      for (const puRow of perUnitRows) {
        const puData = puRow.data_json || {};
        if (Object.keys(puData).length === 0) continue;

        const accountingData = {};
        for (const [key, val] of Object.entries(puData)) {
          accountingData[key] = val * newAcres;
        }

        await prisma.monthlyData.update({
          where: {
            farm_id_fiscal_year_month_type: {
              farm_id: farmId, fiscal_year: fy, month: puRow.month, type: 'accounting',
            },
          },
          data: { data_json: accountingData },
        });
      }
    }

    res.json(assumption);
  } catch (err) {
    next(err);
  }
});

// FREEZE budget
router.post('/:farmId/assumptions/:year/freeze', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const assumption = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
    });
    if (!assumption) {
      return res.status(404).json({ error: 'Assumptions not found' });
    }
    if (assumption.is_frozen) {
      return res.status(400).json({ error: 'Budget is already frozen' });
    }

    // Copy all monthly_data rows to monthly_data_frozen
    const monthlyDataRows = await prisma.monthlyData.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear },
    });

    // Delete any existing frozen data for this year
    await prisma.monthlyDataFrozen.deleteMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear },
    });

    // Create frozen copies
    for (const row of monthlyDataRows) {
      await prisma.monthlyDataFrozen.create({
        data: {
          farm_id: row.farm_id,
          fiscal_year: row.fiscal_year,
          month: row.month,
          type: row.type,
          data_json: row.data_json,
          is_actual: row.is_actual,
          comments_json: row.comments_json,
        },
      });
    }

    // Mark assumptions as frozen
    await prisma.assumption.update({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
      data: { is_frozen: true, frozen_at: new Date() },
    });

    const io = req.app.get('io');
    if (io) emitDataChange(io, farmId, aiEvents.budgetFrozen(fiscalYear));

    res.json({ message: 'Budget frozen successfully' });
  } catch (err) {
    next(err);
  }
});

// UNFREEZE budget (admin only)
router.post('/:farmId/assumptions/:year/unfreeze', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const assumption = await prisma.assumption.findUnique({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
    });
    if (!assumption) {
      return res.status(404).json({ error: 'Assumptions not found' });
    }
    if (!assumption.is_frozen) {
      return res.status(400).json({ error: 'Budget is not frozen' });
    }

    // Unfreeze — keep frozen data intact for forecast comparisons
    await prisma.assumption.update({
      where: { farm_id_fiscal_year: { farm_id: farmId, fiscal_year: fiscalYear } },
      data: { is_frozen: false, frozen_at: null },
    });

    const io = req.app.get('io');
    if (io) emitDataChange(io, farmId, aiEvents.budgetUnfrozen(fiscalYear));

    res.json({ message: 'Budget unfrozen successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
