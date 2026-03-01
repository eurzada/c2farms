import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { convertBuToKg } from '../services/inventoryService.js';

const router = Router();

// GET commodities for a farm
router.get('/:farmId/inventory/commodities', authenticate, async (req, res, next) => {
  try {
    const commodities = await prisma.commodity.findMany({
      where: { farm_id: req.params.farmId },
      orderBy: { name: 'asc' },
    });
    res.json({ commodities });
  } catch (err) { next(err); }
});

// POST create commodity
router.post('/:farmId/inventory/commodities', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, code, lbs_per_bu } = req.body;
    if (!name || !code || !lbs_per_bu) {
      return res.status(400).json({ error: 'name, code, and lbs_per_bu are required' });
    }
    const commodity = await prisma.commodity.create({
      data: { farm_id: req.params.farmId, name, code, lbs_per_bu: parseFloat(lbs_per_bu) },
    });
    res.status(201).json({ commodity });
  } catch (err) { next(err); }
});

// GET locations for a farm
router.get('/:farmId/inventory/locations', authenticate, async (req, res, next) => {
  try {
    const locations = await prisma.inventoryLocation.findMany({
      where: { farm_id: req.params.farmId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { bins: true } } },
    });
    res.json({ locations });
  } catch (err) { next(err); }
});

// GET bins with filters
router.get('/:farmId/inventory/bins', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { location, commodity, status, periodId } = req.query;

    const where = { farm_id: farmId, is_active: true };
    if (location) where.location_id = location;
    if (commodity) where.commodity_id = commodity;

    const bins = await prisma.inventoryBin.findMany({
      where,
      include: {
        location: true,
        commodity: true,
        bin_counts: {
          where: periodId ? { count_period_id: periodId } : {},
          orderBy: { count_period: { period_date: 'desc' } },
          take: 1,
          include: { commodity: true, count_period: true },
        },
      },
      orderBy: [{ location: { name: 'asc' } }, { bin_number: 'asc' }],
    });

    // Flatten latest count into bin data
    const result = bins.map(bin => {
      const latestCount = bin.bin_counts[0] || null;
      return {
        id: bin.id,
        location_id: bin.location_id,
        location_name: bin.location.name,
        location_code: bin.location.code,
        bin_number: bin.bin_number,
        bin_type: bin.bin_type,
        capacity_bu: bin.capacity_bu,
        commodity_id: latestCount?.commodity_id || bin.commodity_id,
        commodity_name: latestCount?.commodity?.name || bin.commodity?.name || null,
        commodity_code: latestCount?.commodity?.code || bin.commodity?.code || null,
        bushels: latestCount?.bushels || 0,
        kg: latestCount?.kg || 0,
        crop_year: latestCount?.crop_year || null,
        notes: latestCount?.notes || bin.notes || null,
        period_date: latestCount?.count_period?.period_date || null,
        status: latestCount?.bushels > 0 ? 'active' : 'empty',
      };
    });

    // Filter by status if requested
    const filtered = status ? result.filter(b => b.status === status) : result;

    res.json({ bins: filtered, total: filtered.length });
  } catch (err) { next(err); }
});

// POST create bin
router.post('/:farmId/inventory/bins', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { location_id, bin_number, bin_type, capacity_bu, commodity_id, notes } = req.body;
    if (!location_id || !bin_number) {
      return res.status(400).json({ error: 'location_id and bin_number are required' });
    }
    const bin = await prisma.inventoryBin.create({
      data: {
        farm_id: req.params.farmId, location_id, bin_number,
        bin_type: bin_type || 'hopper',
        capacity_bu: capacity_bu ? parseFloat(capacity_bu) : null,
        commodity_id: commodity_id || null,
        notes: notes || null,
      },
    });
    res.status(201).json({ bin });
  } catch (err) { next(err); }
});

// PUT update bin
router.put('/:farmId/inventory/bins/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { bin_type, capacity_bu, commodity_id, notes, is_active } = req.body;
    const bin = await prisma.inventoryBin.update({
      where: { id: req.params.id },
      data: {
        ...(bin_type !== undefined && { bin_type }),
        ...(capacity_bu !== undefined && { capacity_bu: parseFloat(capacity_bu) }),
        ...(commodity_id !== undefined && { commodity_id }),
        ...(notes !== undefined && { notes }),
        ...(is_active !== undefined && { is_active }),
      },
    });
    res.json({ bin });
  } catch (err) { next(err); }
});

// GET count periods
router.get('/:farmId/inventory/count-periods', authenticate, async (req, res, next) => {
  try {
    const periods = await prisma.countPeriod.findMany({
      where: { farm_id: req.params.farmId },
      orderBy: { period_date: 'desc' },
    });
    res.json({ periods });
  } catch (err) { next(err); }
});

// POST create count period
router.post('/:farmId/inventory/count-periods', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { period_date, crop_year } = req.body;
    if (!period_date || !crop_year) {
      return res.status(400).json({ error: 'period_date and crop_year are required' });
    }
    const period = await prisma.countPeriod.create({
      data: { farm_id: req.params.farmId, period_date: new Date(period_date), crop_year: parseInt(crop_year) },
    });
    res.status(201).json({ period });
  } catch (err) { next(err); }
});

// PUT update count period (close/reopen)
router.put('/:farmId/inventory/count-periods/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const period = await prisma.countPeriod.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json({ period });
  } catch (err) { next(err); }
});

// GET bin counts for a period
router.get('/:farmId/inventory/count-periods/:id/counts', authenticate, async (req, res, next) => {
  try {
    const counts = await prisma.binCount.findMany({
      where: { farm_id: req.params.farmId, count_period_id: req.params.id },
      include: { bin: { include: { location: true } }, commodity: true },
      orderBy: [{ bin: { location: { name: 'asc' } } }, { bin: { bin_number: 'asc' } }],
    });
    res.json({ counts });
  } catch (err) { next(err); }
});

// POST create submission (draft)
router.post('/:farmId/inventory/submissions', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { count_period_id, location_id } = req.body;
    if (!count_period_id || !location_id) {
      return res.status(400).json({ error: 'count_period_id and location_id are required' });
    }
    const submission = await prisma.countSubmission.upsert({
      where: {
        farm_id_count_period_id_location_id: {
          farm_id: req.params.farmId, count_period_id, location_id,
        },
      },
      update: { status: 'draft', submitted_by: req.userId },
      create: {
        farm_id: req.params.farmId, count_period_id, location_id,
        status: 'draft', submitted_by: req.userId,
      },
    });
    res.status(201).json({ submission });
  } catch (err) { next(err); }
});

// PUT update submission (save/submit)
router.put('/:farmId/inventory/submissions/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const submission = await prisma.countSubmission.update({
      where: { id: req.params.id },
      data: {
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
        submitted_by: req.userId,
      },
    });
    res.json({ submission });
  } catch (err) { next(err); }
});

// POST approve submission
router.post('/:farmId/inventory/submissions/:id/approve', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const submission = await prisma.countSubmission.update({
      where: { id: req.params.id },
      data: { status: 'approved' },
    });
    res.json({ submission });
  } catch (err) { next(err); }
});

// POST reject submission
router.post('/:farmId/inventory/submissions/:id/reject', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { notes } = req.body;
    const submission = await prisma.countSubmission.update({
      where: { id: req.params.id },
      data: { status: 'rejected', notes: notes || null },
    });
    res.json({ submission });
  } catch (err) { next(err); }
});

// POST bulk upsert bin counts for a period
router.post('/:farmId/inventory/bin-counts/:periodId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { periodId } = req.params;
    const { counts } = req.body; // [{ bin_id, commodity_id, bushels, crop_year, notes }]

    if (!Array.isArray(counts)) {
      return res.status(400).json({ error: 'counts array is required' });
    }

    // Verify period is open
    const period = await prisma.countPeriod.findUnique({ where: { id: periodId } });
    if (!period || period.status === 'closed') {
      return res.status(400).json({ error: 'Count period is closed' });
    }

    // Look up commodities for kg conversion
    const commodities = await prisma.commodity.findMany({ where: { farm_id: farmId } });
    const commodityLookup = Object.fromEntries(commodities.map(c => [c.id, c]));

    const results = [];
    for (const item of counts) {
      const { bin_id, commodity_id, bushels, crop_year, notes } = item;
      const commodity = commodity_id ? commodityLookup[commodity_id] : null;
      const lbsPerBu = commodity?.lbs_per_bu || 60;
      const kg = convertBuToKg(parseFloat(bushels) || 0, lbsPerBu);

      const record = await prisma.binCount.upsert({
        where: {
          farm_id_count_period_id_bin_id: { farm_id: farmId, count_period_id: periodId, bin_id },
        },
        update: { commodity_id: commodity_id || null, bushels: parseFloat(bushels) || 0, kg, crop_year: crop_year ? parseInt(crop_year) : null, notes: notes || null },
        create: { farm_id: farmId, count_period_id: periodId, bin_id, commodity_id: commodity_id || null, bushels: parseFloat(bushels) || 0, kg, crop_year: crop_year ? parseInt(crop_year) : null, notes: notes || null },
      });
      results.push(record);
    }

    res.json({ counts: results, total: results.length });
  } catch (err) { next(err); }
});

export default router;
