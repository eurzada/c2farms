import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireAnyFarmAdmin } from '../middleware/auth.js';

const router = Router();

const adminGuard = [authenticate, requireAnyFarmAdmin];

// GET /users-grid — all users, all farms, role matrix, pending invites
router.get('/users-grid', ...adminGuard, async (req, res, next) => {
  try {
    const [users, farms, roles, invites] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, email: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.farm.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.userFarmRole.findMany({
        select: { user_id: true, farm_id: true, role: true },
      }),
      prisma.farmInvite.findMany({
        where: { status: 'pending' },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    // Build role matrix: { [userId]: { [farmId]: role } }
    const roleMatrix = {};
    for (const r of roles) {
      if (!roleMatrix[r.user_id]) roleMatrix[r.user_id] = {};
      roleMatrix[r.user_id][r.farm_id] = r.role;
    }

    res.json({
      users,
      farms,
      roleMatrix,
      invites,
      adminFarmIds: req.adminFarmIds,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /users/:userId/farms/:farmId/role — change role
router.patch('/users/:userId/farms/:farmId/role', ...adminGuard, async (req, res, next) => {
  try {
    const { userId, farmId } = req.params;
    const { role } = req.body;

    if (!req.adminFarmIds.includes(farmId)) {
      return res.status(403).json({ error: 'You are not admin on this farm' });
    }

    const validRoles = ['admin', 'manager', 'viewer'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Valid role required (admin, manager, viewer)' });
    }

    // Last-admin protection
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

// POST /users/:userId/farms/:farmId — add user to farm
router.post('/users/:userId/farms/:farmId', ...adminGuard, async (req, res, next) => {
  try {
    const { userId, farmId } = req.params;
    const { role } = req.body;

    if (!req.adminFarmIds.includes(farmId)) {
      return res.status(403).json({ error: 'You are not admin on this farm' });
    }

    const validRoles = ['admin', 'manager', 'viewer'];
    const assignRole = validRoles.includes(role) ? role : 'viewer';

    const existing = await prisma.userFarmRole.findUnique({
      where: { user_id_farm_id: { user_id: userId, farm_id: farmId } },
    });
    if (existing) {
      return res.status(409).json({ error: 'User already has access to this farm' });
    }

    await prisma.userFarmRole.create({
      data: { user_id: userId, farm_id: farmId, role: assignRole },
    });

    res.status(201).json({ message: 'User added to farm', role: assignRole });
  } catch (err) {
    next(err);
  }
});

// DELETE /users/:userId/farms/:farmId — remove user from farm
router.delete('/users/:userId/farms/:farmId', ...adminGuard, async (req, res, next) => {
  try {
    const { userId, farmId } = req.params;

    if (!req.adminFarmIds.includes(farmId)) {
      return res.status(403).json({ error: 'You are not admin on this farm' });
    }

    // Last-admin protection
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

// POST /bulk-invite — invite email to multiple farms
router.post('/bulk-invite', ...adminGuard, async (req, res, next) => {
  try {
    const { email, assignments } = req.body;

    if (!email || !assignments || !Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ error: 'email and assignments array required' });
    }

    const validRoles = ['admin', 'manager', 'viewer'];
    const results = [];

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });

    for (const { farmId, role } of assignments) {
      if (!req.adminFarmIds.includes(farmId)) {
        results.push({ farmId, status: 'skipped', reason: 'Not admin on this farm' });
        continue;
      }

      const assignRole = validRoles.includes(role) ? role : 'viewer';

      if (existingUser) {
        // User exists — check for existing access
        const existing = await prisma.userFarmRole.findUnique({
          where: { user_id_farm_id: { user_id: existingUser.id, farm_id: farmId } },
        });
        if (existing) {
          results.push({ farmId, status: 'skipped', reason: 'Already has access' });
          continue;
        }

        await prisma.userFarmRole.create({
          data: { user_id: existingUser.id, farm_id: farmId, role: assignRole },
        });
        results.push({ farmId, status: 'added', role: assignRole });
      } else {
        // User doesn't exist — create invite
        await prisma.farmInvite.upsert({
          where: { farm_id_email: { farm_id: farmId, email } },
          update: { role: assignRole, invited_by: req.userId, status: 'pending', expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
          create: {
            farm_id: farmId,
            email,
            role: assignRole,
            invited_by: req.userId,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        results.push({ farmId, status: 'invited', role: assignRole });
      }
    }

    res.status(201).json({ message: 'Bulk invite processed', results });
  } catch (err) {
    next(err);
  }
});

// DELETE /invites/:inviteId — cancel a pending invite
router.delete('/invites/:inviteId', ...adminGuard, async (req, res, next) => {
  try {
    const { inviteId } = req.params;

    const invite = await prisma.farmInvite.findUnique({ where: { id: inviteId } });
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    if (!req.adminFarmIds.includes(invite.farm_id)) {
      return res.status(403).json({ error: 'You are not admin on this farm' });
    }

    await prisma.farmInvite.delete({ where: { id: inviteId } });

    res.json({ message: 'Invite cancelled' });
  } catch (err) {
    next(err);
  }
});

export default router;
