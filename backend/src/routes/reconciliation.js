import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { computeReconciliation } from '../services/inventoryService.js';

const router = Router();

// GET reconciliation between two periods
router.get('/:farmId/reconciliation/:fromPeriodId/:toPeriodId', authenticate, async (req, res, next) => {
  try {
    const { farmId, fromPeriodId, toPeriodId } = req.params;
    const result = await computeReconciliation(farmId, fromPeriodId, toPeriodId);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
