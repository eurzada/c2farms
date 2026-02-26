import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as qbService from '../services/quickbooksService.js';

// General QB routes (mounted at /api/quickbooks)
export const qbGeneralRouter = Router();

qbGeneralRouter.get('/auth-url', authenticate, async (req, res, next) => {
  try {
    const farmId = req.query.farmId;
    if (!farmId) return res.status(400).json({ error: 'farmId query param required' });

    // Verify user has access to the requested farm
    const role = await prisma.userFarmRole.findUnique({
      where: { user_id_farm_id: { user_id: req.userId, farm_id: farmId } },
    });
    if (!role) {
      return res.status(403).json({ error: 'Access denied: no access to this farm' });
    }

    const result = qbService.getAuthUrl(farmId, req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

qbGeneralRouter.get('/callback', async (req, res, next) => {
  try {
    const { code, realmId, state } = req.query;
    await qbService.handleCallback(code, realmId, state);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/accounting?qb=connected`);
  } catch (err) {
    next(err);
  }
});

// Farm-specific QB routes (mounted at /api/farms)
export const qbFarmRouter = Router();

qbFarmRouter.post('/:farmId/quickbooks/sync', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { start_date, end_date, fiscal_year } = req.body;
    const result = await qbService.syncExpenses(farmId, start_date, end_date, fiscal_year);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

qbFarmRouter.get('/:farmId/quickbooks/mappings', authenticate, async (req, res, next) => {
  try {
    const mappings = await qbService.getMappings(req.params.farmId);
    res.json(mappings);
  } catch (err) {
    next(err);
  }
});

qbFarmRouter.post('/:farmId/quickbooks/mappings', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { qb_account, category_code, weight } = req.body;
    const mapping = await qbService.upsertMapping(req.params.farmId, qb_account, category_code, weight);
    res.json(mapping);
  } catch (err) {
    next(err);
  }
});
