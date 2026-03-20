import { Router } from 'express';
import prisma from '../config/database.js';
import { queryActivity, activitySummary } from '../services/activityService.js';

const router = Router();

// Verify user is admin on at least one farm
async function requireAdmin(req, res, next) {
  const adminRoles = await prisma.userFarmRole.findMany({
    where: { user_id: req.userId, role: 'admin' },
    select: { farm_id: true },
    take: 1,
  });
  if (adminRoles.length === 0) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// GET /api/admin/activity?since=&until=&userId=&ip=&action=&limit=&offset=
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { since, until, userId, ip, action, limit, offset } = req.query;
    const result = await queryActivity({
      userId: userId || undefined,
      ipAddress: ip || undefined,
      action: action || undefined,
      since: since || undefined,
      until: until || undefined,
      limit: Math.min(parseInt(limit) || 100, 500),
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/activity/summary?since=&until=
router.get('/summary', requireAdmin, async (req, res, next) => {
  try {
    const { since, until } = req.query;
    const summary = await activitySummary({
      since: since || undefined,
      until: until || undefined,
    });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

export default router;
