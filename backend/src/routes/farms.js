import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireFarmAccess, requireRole } from '../middleware/auth.js';

const router = Router();

// POST /api/farms — create a new farm + admin role for the current user
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Farm name is required' });
    }

    const farm = await prisma.farm.create({
      data: { name: name.trim() },
    });

    await prisma.userFarmRole.create({
      data: { user_id: req.userId, farm_id: farm.id, role: 'admin' },
    });

    res.status(201).json({ ...farm, role: 'admin' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/farms/:farmId — update farm name
router.patch('/:farmId', authenticate, requireFarmAccess, requireRole('admin'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Farm name is required' });
    }

    const farm = await prisma.farm.update({
      where: { id: farmId },
      data: { name: name.trim() },
    });

    res.json(farm);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/farms/:farmId — delete farm and all related data
router.delete('/:farmId', authenticate, requireFarmAccess, requireRole('admin'), async (req, res, next) => {
  try {
    const { farmId } = req.params;

    await prisma.$transaction([
      prisma.monthlyDataFrozen.deleteMany({ where: { farm_id: farmId } }),
      prisma.monthlyData.deleteMany({ where: { farm_id: farmId } }),
      prisma.assumption.deleteMany({ where: { farm_id: farmId } }),
      prisma.qbCategoryMapping.deleteMany({ where: { farm_id: farmId } }),
      prisma.qbToken.deleteMany({ where: { farm_id: farmId } }),
      prisma.farmInvite.deleteMany({ where: { farm_id: farmId } }),
      prisma.userFarmRole.deleteMany({ where: { farm_id: farmId } }),
      prisma.farm.delete({ where: { id: farmId } }),
    ]);

    res.json({ message: 'Farm deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
