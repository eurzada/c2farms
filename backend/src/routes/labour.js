import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { authenticate } from '../middleware/auth.js';
import * as svc from '../services/labourService.js';

const router = Router();

// ─── Cross-farm routes (mounted at /api/labour) ────────────────────
export const labourGeneralRouter = Router();

labourGeneralRouter.post('/bulk-status', authenticate, async (req, res, next) => {
  try {
    const { fiscal_year, status } = req.body;
    if (!fiscal_year || !['draft', 'locked'].includes(status)) {
      return res.status(400).json({ error: 'fiscal_year and status (draft or locked) required' });
    }
    const { default: prisma } = await import('../config/database.js');
    const adminRole = await prisma.userFarmRole.findFirst({
      where: { user_id: req.userId, role: 'admin' },
    });
    if (!adminRole) return res.status(403).json({ error: 'Admin access required' });
    const result = await svc.bulkUpdatePlanStatus(fiscal_year, status);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /:farmId/labour/plan?year=2026
router.get('/:farmId/labour/plan', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || 2026;
    const plan = await svc.getPlan(req.params.farmId, year);
    res.json(plan || null);
  } catch (err) { next(err); }
});

// POST /:farmId/labour/plan  { fiscal_year, avg_wage }
router.post('/:farmId/labour/plan', requireRole('manager'), async (req, res, next) => {
  try {
    const { fiscal_year, avg_wage } = req.body;
    const plan = await svc.createPlan(req.params.farmId, fiscal_year || 2026, avg_wage);
    res.status(201).json(plan);
  } catch (err) { next(err); }
});

// PATCH /:farmId/labour/plan/:planId  { avg_wage, notes, status, total_acres }
router.patch('/:farmId/labour/plan/:planId', requireRole('manager'), async (req, res, next) => {
  try {
    const plan = await svc.updatePlan(req.params.planId, req.body);
    res.json(plan);
  } catch (err) { next(err); }
});

// PUT /:farmId/labour/plan/:planId/seasons  { seasons: [...] }
router.put('/:farmId/labour/plan/:planId/seasons', requireRole('manager'), async (req, res, next) => {
  try {
    const plan = await svc.bulkUpdateSeasons(req.params.planId, req.body.seasons);
    res.json(plan);
  } catch (err) { next(err); }
});

// POST /:farmId/labour/plan/:planId/push
router.post('/:farmId/labour/plan/:planId/push', requireRole('manager'), async (req, res, next) => {
  try {
    const result = await svc.pushToForecast(req.params.planId);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /:farmId/labour/dashboard?year=2026
router.get('/:farmId/labour/dashboard', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || 2026;
    const dashboard = await svc.getDashboard(req.params.farmId, year);
    res.json(dashboard || null);
  } catch (err) { next(err); }
});

export default router;
