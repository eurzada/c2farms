import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as fieldOpsService from '../services/fieldOpsService.js';

// ─── General routes (mounted at /api/fieldops) ─────────────────────
export const fieldOpsGeneralRouter = Router();

// GET /api/fieldops/auth-url?farmId=...
fieldOpsGeneralRouter.get('/auth-url', authenticate, async (req, res, next) => {
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

    const result = fieldOpsService.getAuthUrl(farmId, req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/fieldops/callback — CNH redirects here after user authorizes
fieldOpsGeneralRouter.get('/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state parameter' });
    }
    const result = await fieldOpsService.handleCallback(code, state);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/equipment?fieldops=connected`);
  } catch (err) {
    next(err);
  }
});

// ─── Farm-scoped routes (mounted at /api/farms) ────────────────────
export const fieldOpsFarmRouter = Router();

// GET /:farmId/fieldops/status
fieldOpsFarmRouter.get('/:farmId/fieldops/status', authenticate, async (req, res, next) => {
  try {
    const status = await fieldOpsService.getConnectionStatus(req.params.farmId);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// DELETE /:farmId/fieldops/disconnect
fieldOpsFarmRouter.delete('/:farmId/fieldops/disconnect', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await fieldOpsService.disconnect(req.params.farmId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── Equipment / Fleet endpoints ───────────────────────────────────

// GET /:farmId/fieldops/fleet?page=1
fieldOpsFarmRouter.get('/:farmId/fieldops/fleet', authenticate, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const data = await fieldOpsService.getFleet(req.params.farmId, page);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /:farmId/fieldops/equipment/:vin
fieldOpsFarmRouter.get('/:farmId/fieldops/equipment/:vin', authenticate, async (req, res, next) => {
  try {
    const data = await fieldOpsService.getEquipment(req.params.farmId, req.params.vin);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /:farmId/fieldops/equipment/:vin/locations?start=...&end=...&page=1
fieldOpsFarmRouter.get('/:farmId/fieldops/equipment/:vin/locations', authenticate, async (req, res, next) => {
  try {
    const { start, end, page } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end query params required' });
    const data = await fieldOpsService.getEquipmentLocations(req.params.farmId, req.params.vin, start, end, parseInt(page) || 1);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /:farmId/fieldops/equipment/:vin/fuel?start=...&end=...&page=1
fieldOpsFarmRouter.get('/:farmId/fieldops/equipment/:vin/fuel', authenticate, async (req, res, next) => {
  try {
    const { start, end, page } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end query params required' });
    const data = await fieldOpsService.getEquipmentFuelUsed(req.params.farmId, req.params.vin, start, end, parseInt(page) || 1);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /:farmId/fieldops/equipment/:vin/engine-hours?start=...&end=...&page=1
fieldOpsFarmRouter.get('/:farmId/fieldops/equipment/:vin/engine-hours', authenticate, async (req, res, next) => {
  try {
    const { start, end, page } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end query params required' });
    const data = await fieldOpsService.getEquipmentEngineHours(req.params.farmId, req.params.vin, start, end, parseInt(page) || 1);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── Farm Setup endpoints ──────────────────────────────────────────

// GET /:farmId/fieldops/companies
fieldOpsFarmRouter.get('/:farmId/fieldops/companies', authenticate, async (req, res, next) => {
  try {
    const data = await fieldOpsService.getCompanies(req.params.farmId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /:farmId/fieldops/companies/:companyId/farms/:cFarmId/fields
fieldOpsFarmRouter.get('/:farmId/fieldops/companies/:companyId/farms/:cFarmId/fields', authenticate, async (req, res, next) => {
  try {
    const data = await fieldOpsService.getFields(req.params.farmId, req.params.companyId, req.params.cFarmId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Generic proxy for any FieldOps API path not covered above
// GET /:farmId/fieldops/api/*
fieldOpsFarmRouter.get('/:farmId/fieldops/api/*', authenticate, async (req, res, next) => {
  try {
    const apiPath = '/' + req.params[0];
    const data = await fieldOpsService.fieldOpsApi(req.params.farmId, apiPath);
    res.json(data);
  } catch (err) {
    next(err);
  }
});
