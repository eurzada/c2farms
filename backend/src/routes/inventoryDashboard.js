import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDashboardData } from '../services/inventoryService.js';
import { resolveInventoryFarm } from '../services/resolveInventoryFarm.js';
import prisma from '../config/database.js';

const router = Router();

// GET inventory dashboard data
// Accepts optional ?location_id=xxx or ?bu_farm_name=Lewvan for BU scoping
router.get('/:farmId/inventory/dashboard', authenticate, async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    let locationId = req.query.location_id || null;

    // Resolve BU farm name to an inventory location (e.g. "Lewvan" → Lewvan location)
    if (!locationId && req.query.bu_farm_name) {
      const loc = await prisma.inventoryLocation.findFirst({
        where: { farm_id: farmId, name: { equals: req.query.bu_farm_name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (loc) locationId = loc.id;
    }

    const result = await getDashboardData(farmId, { locationId });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
