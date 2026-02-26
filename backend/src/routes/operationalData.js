import { Router } from 'express';
import prisma from '../config/database.js';
import { requireRole } from '../middleware/auth.js';
import { parseYear } from '../utils/fiscalYear.js';

const router = Router();

// GET /:farmId/operational-data/:year
router.get('/:farmId/operational-data/:year', async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const rows = await prisma.operationalData.findMany({
      where: { farm_id: farmId, fiscal_year: fiscalYear },
      orderBy: { month: 'asc' },
    });

    // Group by metric
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.metric]) grouped[row.metric] = {};
      grouped[row.metric][row.month] = {
        budget_value: row.budget_value,
        actual_value: row.actual_value,
      };
    }

    res.json(grouped);
  } catch (err) {
    next(err);
  }
});

// PUT /:farmId/operational-data/:year — upsert batch
router.put('/:farmId/operational-data/:year', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const updates = req.body; // Array of { metric, month, budget_value?, actual_value? }
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'Body must be an array of updates' });
    }

    const results = await Promise.all(
      updates.map(({ metric, month, budget_value, actual_value }) =>
        prisma.operationalData.upsert({
          where: {
            farm_id_fiscal_year_month_metric: {
              farm_id: farmId,
              fiscal_year: fiscalYear,
              month,
              metric,
            },
          },
          update: {
            ...(budget_value !== undefined && { budget_value }),
            ...(actual_value !== undefined && { actual_value }),
          },
          create: {
            farm_id: farmId,
            fiscal_year: fiscalYear,
            month,
            metric,
            budget_value: budget_value ?? 0,
            actual_value: actual_value ?? 0,
          },
        })
      )
    );

    res.json({ updated: results.length });
  } catch (err) {
    next(err);
  }
});

export default router;
