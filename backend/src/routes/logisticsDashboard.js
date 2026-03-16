import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { resolveInventoryFarm } from '../services/resolveInventoryFarm.js';
import { getLogisticsDashboard, getMissingLoadsForSettlement } from '../services/logisticsDashboardService.js';
import { parseYear } from '../utils/fiscalYear.js';

const router = Router();

// Logistics is enterprise-wide — resolve BU farm → enterprise farm
router.use('/:farmId/logistics', async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    req.params.farmId = farmId;
    next();
  } catch (err) { next(err); }
});

// GET logistics dashboard
router.get('/:farmId/logistics/dashboard', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = parseYear(req.query.fiscal_year);
    const month = req.query.month || null;
    const result = await getLogisticsDashboard(req.params.farmId, { fiscalYear, month });
    res.json(result);
  } catch (err) { next(err); }
});

// GET missing loads for a specific settlement
router.get('/:farmId/logistics/missing-loads/:settlementId', authenticate, async (req, res, next) => {
  try {
    const result = await getMissingLoadsForSettlement(req.params.farmId, req.params.settlementId);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
