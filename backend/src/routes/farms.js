import { Router } from 'express';
import bcrypt from 'bcrypt';
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

// ───── Trucker Management (admin only) ─────

// GET /:farmId/truckers — list truckers for a farm
router.get('/:farmId/truckers', authenticate, requireFarmAccess, requireRole('admin'), async (req, res, next) => {
  try {
    const roles = await prisma.userFarmRole.findMany({
      where: { farm_id: req.params.farmId },
      include: {
        user: { select: { id: true, email: true, name: true, created_at: true } },
      },
    });

    // Enrich with ticket counts and last activity
    const userIds = roles.map(r => r.user_id);
    const ticketCounts = await prisma.deliveryTicket.groupBy({
      by: ['submitted_by'],
      where: { farm_id: req.params.farmId, submitted_by: { in: userIds } },
      _count: true,
    });
    const countMap = Object.fromEntries(ticketCounts.map(t => [t.submitted_by, t._count]));

    const lastTickets = await prisma.deliveryTicket.findMany({
      where: { farm_id: req.params.farmId, submitted_by: { in: userIds } },
      orderBy: { created_at: 'desc' },
      distinct: ['submitted_by'],
      select: { submitted_by: true, created_at: true },
    });
    const lastActiveMap = Object.fromEntries(lastTickets.map(t => [t.submitted_by, t.created_at]));

    const truckers = roles.map(r => ({
      id: r.user.id,
      email: r.user.email,
      name: r.user.name,
      role: r.role,
      ticket_count: countMap[r.user.id] || 0,
      last_active: lastActiveMap[r.user.id] || null,
      created_at: r.user.created_at,
    }));

    res.json({ truckers });
  } catch (err) { next(err); }
});

// POST /:farmId/truckers — create a trucker user account + farm role
router.post('/:farmId/truckers', authenticate, requireFarmAccess, requireRole('admin'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { email, name, password } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ error: 'email, name, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    let user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

    if (user) {
      // Check if they already have a role on this farm
      const existingRole = await prisma.userFarmRole.findUnique({
        where: { user_id_farm_id: { user_id: user.id, farm_id: farmId } },
      });
      if (existingRole) {
        return res.status(409).json({ error: 'User already has access to this farm' });
      }
    } else {
      // Create new user
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await prisma.user.create({
        data: {
          email: email.toLowerCase().trim(),
          name: name.trim(),
          password_hash: hashedPassword,
        },
      });
    }

    // Create farm role (viewer role — can submit tickets but not edit budgets)
    await prisma.userFarmRole.create({
      data: { user_id: user.id, farm_id: farmId, role: 'viewer' },
    });

    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: 'viewer',
    });
  } catch (err) { next(err); }
});

// DELETE /:farmId/truckers/:userId — remove trucker's farm access
router.delete('/:farmId/truckers/:userId', authenticate, requireFarmAccess, requireRole('admin'), async (req, res, next) => {
  try {
    const { farmId, userId } = req.params;

    // Prevent removing yourself
    if (userId === req.userId) {
      return res.status(400).json({ error: 'Cannot remove your own access' });
    }

    const deleted = await prisma.userFarmRole.deleteMany({
      where: { user_id: userId, farm_id: farmId },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ error: 'User not found on this farm' });
    }

    res.json({ message: 'Trucker access removed' });
  } catch (err) { next(err); }
});

export default router;
