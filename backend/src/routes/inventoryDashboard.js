import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDashboardData } from '../services/inventoryService.js';

const router = Router();

// GET inventory dashboard data
router.get('/:farmId/inventory/dashboard', authenticate, async (req, res, next) => {
  try {
    const result = await getDashboardData(req.params.farmId);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
