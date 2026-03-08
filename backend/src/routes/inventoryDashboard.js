import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDashboardData } from '../services/inventoryService.js';
import { resolveInventoryFarm } from '../services/resolveInventoryFarm.js';

const router = Router();

// GET inventory dashboard data
router.get('/:farmId/inventory/dashboard', authenticate, async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const result = await getDashboardData(farmId);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
