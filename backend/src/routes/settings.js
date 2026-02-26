import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireFarmAccess, requireRole } from '../middleware/auth.js';

const router = Router();

// All settings routes require admin role
const adminOnly = [authenticate, requireFarmAccess, requireRole('admin')];

// GET /:farmId/settings/users — list users + roles + pending invites
router.get('/:farmId/settings/users', ...adminOnly, async (req, res, next) => {
  try {
    const { farmId } = req.params;

    const farmRoles = await prisma.userFarmRole.findMany({
      where: { farm_id: farmId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    const users = farmRoles.map(fr => ({
      id: fr.user.id,
      email: fr.user.email,
      name: fr.user.name,
      role: fr.role,
    }));

    const invites = await prisma.farmInvite.findMany({
      where: { farm_id: farmId, status: 'pending' },
      orderBy: { created_at: 'desc' },
    });

    res.json({ users, invites });
  } catch (err) {
    next(err);
  }
});

// POST /:farmId/settings/users/invite — invite user by email
router.post('/:farmId/settings/users/invite', ...adminOnly, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const validRoles = ['admin', 'manager', 'viewer'];
    const inviteRole = validRoles.includes(role) ? role : 'viewer';

    // Check if user already has access
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const existingRole = await prisma.userFarmRole.findUnique({
        where: { user_id_farm_id: { user_id: existingUser.id, farm_id: farmId } },
      });
      if (existingRole) {
        return res.status(409).json({ error: 'User already has access to this farm' });
      }

      // User exists — create UserFarmRole directly
      await prisma.userFarmRole.create({
        data: { user_id: existingUser.id, farm_id: farmId, role: inviteRole },
      });

      return res.status(201).json({
        message: 'User added to farm',
        user: { id: existingUser.id, email: existingUser.email, name: existingUser.name, role: inviteRole },
      });
    }

    // User doesn't exist — create FarmInvite (pending)
    const invite = await prisma.farmInvite.upsert({
      where: { farm_id_email: { farm_id: farmId, email } },
      update: { role: inviteRole, invited_by: req.userId, status: 'pending', expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      create: {
        farm_id: farmId,
        email,
        role: inviteRole,
        invited_by: req.userId,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    res.status(201).json({ message: 'Invite created', invite });
  } catch (err) {
    next(err);
  }
});

// PATCH /:farmId/settings/users/:userId — change user's role
router.patch('/:farmId/settings/users/:userId', ...adminOnly, async (req, res, next) => {
  try {
    const { farmId, userId } = req.params;
    const { role } = req.body;

    const validRoles = ['admin', 'manager', 'viewer'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Valid role is required (admin, manager, viewer)' });
    }

    // Prevent admin from demoting themselves if they're the only admin
    if (userId === req.userId && role !== 'admin') {
      const adminCount = await prisma.userFarmRole.count({
        where: { farm_id: farmId, role: 'admin' },
      });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last admin' });
      }
    }

    const updated = await prisma.userFarmRole.update({
      where: { user_id_farm_id: { user_id: userId, farm_id: farmId } },
      data: { role },
    });

    res.json({ message: 'Role updated', role: updated.role });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'User not found on this farm' });
    }
    next(err);
  }
});

// DELETE /:farmId/settings/users/:userId — remove user from farm
router.delete('/:farmId/settings/users/:userId', ...adminOnly, async (req, res, next) => {
  try {
    const { farmId, userId } = req.params;

    // Prevent admin from removing themselves if they're the only admin
    if (userId === req.userId) {
      const adminCount = await prisma.userFarmRole.count({
        where: { farm_id: farmId, role: 'admin' },
      });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last admin' });
      }
    }

    await prisma.userFarmRole.delete({
      where: { user_id_farm_id: { user_id: userId, farm_id: farmId } },
    });

    res.json({ message: 'User removed from farm' });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'User not found on this farm' });
    }
    next(err);
  }
});

// DELETE /:farmId/settings/invites/:inviteId — cancel pending invite
router.delete('/:farmId/settings/invites/:inviteId', ...adminOnly, async (req, res, next) => {
  try {
    const { farmId, inviteId } = req.params;

    await prisma.farmInvite.delete({
      where: { id: inviteId, farm_id: farmId },
    });

    res.json({ message: 'Invite cancelled' });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Invite not found' });
    }
    next(err);
  }
});

// POST /:farmId/settings/backup — export farm data as JSON
router.post('/:farmId/settings/backup', ...adminOnly, async (req, res, next) => {
  try {
    const { farmId } = req.params;

    const [farm, assumptions, monthlyData, frozenData, categories, glAccounts, glActuals, invites] = await Promise.all([
      prisma.farm.findUnique({ where: { id: farmId } }),
      prisma.assumption.findMany({ where: { farm_id: farmId } }),
      prisma.monthlyData.findMany({ where: { farm_id: farmId } }),
      prisma.monthlyDataFrozen.findMany({ where: { farm_id: farmId } }),
      prisma.farmCategory.findMany({ where: { farm_id: farmId } }),
      prisma.glAccount.findMany({ where: { farm_id: farmId } }),
      prisma.glActualDetail.findMany({ where: { farm_id: farmId } }),
      prisma.farmInvite.findMany({ where: { farm_id: farmId } }),
    ]);

    const backup = {
      exportedAt: new Date().toISOString(),
      farm,
      assumptions,
      monthlyData,
      frozenData,
      categories,
      glAccounts,
      glActuals,
      invites,
    };

    const filename = `c2farms-backup-${farm.name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(backup);
  } catch (err) {
    next(err);
  }
});

export default router;
