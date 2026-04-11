import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import {
  createLot,
  appendBlock,
  verifyChain,
  getPublicProvenance,
  EVENT_TYPES,
} from '../services/traceabilityService.js';

// ─── Farm-scoped router (mounted under /api/farms) ─────────────────
const farmRouter = Router();

// GET /api/farms/:farmId/traceability/lots — list lots with filters
farmRouter.get('/:farmId/traceability/lots', authenticate, async (req, res, next) => {
  try {
    const { cropYear, cropType, status, q } = req.query;
    const where = { farm_id: req.params.farmId };
    if (cropYear) where.crop_year = parseInt(cropYear, 10);
    if (cropType) where.crop_type = cropType;
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { lot_code: { contains: q, mode: 'insensitive' } },
        { farm_site: { contains: q, mode: 'insensitive' } },
        { variety: { contains: q, mode: 'insensitive' } },
      ];
    }
    const lots = await prisma.traceabilityLot.findMany({
      where,
      orderBy: [{ crop_year: 'desc' }, { created_at: 'desc' }],
      include: {
        origin_bin: { select: { id: true, bin_number: true } },
        origin_location: { select: { id: true, name: true, code: true } },
      },
    });
    res.json({ lots });
  } catch (err) { next(err); }
});

// GET /api/farms/:farmId/traceability/lots/:lotId — lot detail + full chain
farmRouter.get('/:farmId/traceability/lots/:lotId', authenticate, async (req, res, next) => {
  try {
    const lot = await prisma.traceabilityLot.findFirst({
      where: { id: req.params.lotId, farm_id: req.params.farmId },
      include: {
        origin_bin: { select: { id: true, bin_number: true } },
        origin_location: { select: { id: true, name: true, code: true } },
        blocks: { orderBy: { block_index: 'asc' } },
      },
    });
    if (!lot) return res.status(404).json({ error: 'Lot not found' });
    res.json({ lot });
  } catch (err) { next(err); }
});

// POST /api/farms/:farmId/traceability/lots — create new lot + genesis block
farmRouter.post('/:farmId/traceability/lots', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const {
      crop_year,
      crop_type,
      variety,
      grade,
      farm_site,
      origin_bin_id,
      origin_location_id,
      bushels,
      net_weight_mt,
      lot_code,
      metadata,
      notes,
    } = req.body;

    if (!crop_year || !crop_type) {
      return res.status(400).json({ error: 'crop_year and crop_type are required' });
    }

    const lot = await createLot({
      farmId: req.params.farmId,
      cropYear: parseInt(crop_year, 10),
      cropType: crop_type,
      variety,
      grade,
      farmSite: farm_site,
      originBinId: origin_bin_id,
      originLocationId: origin_location_id,
      bushels: bushels !== undefined ? parseFloat(bushels) : undefined,
      netWeightMt: net_weight_mt !== undefined ? parseFloat(net_weight_mt) : undefined,
      actorUserId: req.userId,
      actorName: req.user?.name || req.user?.email,
      metadata,
      lotCode: lot_code,
      notes,
    });

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'TraceabilityLot',
      entityId: lot.id,
      action: 'create',
      changes: { lot_code: lot.lot_code, crop_year, crop_type },
    });

    res.status(201).json({ lot });
  } catch (err) { next(err); }
});

// POST /api/farms/:farmId/traceability/lots/:lotId/blocks — append event block
farmRouter.post('/:farmId/traceability/lots/:lotId/blocks', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const lot = await prisma.traceabilityLot.findFirst({
      where: { id: req.params.lotId, farm_id: req.params.farmId },
      select: { id: true },
    });
    if (!lot) return res.status(404).json({ error: 'Lot not found' });

    const event = {
      ...req.body,
      actor_user_id: req.userId,
      actor_name: req.user?.name || req.user?.email,
    };
    const block = await appendBlock(lot.id, event);

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'TraceabilityBlock',
      entityId: block.id,
      action: 'create',
      changes: { lot_id: lot.id, event_type: block.event_type, block_index: block.block_index },
    });

    res.status(201).json({ block });
  } catch (err) { next(err); }
});

// GET /api/farms/:farmId/traceability/lots/:lotId/verify — verify chain integrity
farmRouter.get('/:farmId/traceability/lots/:lotId/verify', authenticate, async (req, res, next) => {
  try {
    const lot = await prisma.traceabilityLot.findFirst({
      where: { id: req.params.lotId, farm_id: req.params.farmId },
      select: { id: true },
    });
    if (!lot) return res.status(404).json({ error: 'Lot not found' });
    const report = await verifyChain(lot.id);
    res.json(report);
  } catch (err) { next(err); }
});

// GET /api/farms/:farmId/traceability/event-types — enum helper for the UI
farmRouter.get('/:farmId/traceability/event-types', authenticate, (_req, res) => {
  res.json({ event_types: EVENT_TYPES });
});

// ─── Public, unauthenticated router (mounted under /api/traceability) ──
// External buyers can look up provenance by the public lot_code printed
// on delivery paperwork without needing a C2 Farms account.
const publicRouter = Router();

publicRouter.get('/verify/:lotCode', async (req, res, next) => {
  try {
    const provenance = await getPublicProvenance(req.params.lotCode);
    if (!provenance) return res.status(404).json({ error: 'Lot not found' });
    res.json(provenance);
  } catch (err) { next(err); }
});

export { farmRouter, publicRouter };
export default farmRouter;
