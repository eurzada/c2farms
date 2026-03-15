import { Router } from 'express';
import multer from 'multer';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { convertBuToKg } from '../services/inventoryService.js';
import { importInventoryFromExcel } from '../services/inventoryImportService.js';
import { logAudit, diffChanges } from '../services/auditService.js';
import { resolveInventoryFarm } from '../services/resolveInventoryFarm.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET commodities for a farm
router.get('/:farmId/inventory/commodities', authenticate, async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const commodities = await prisma.commodity.findMany({
      where: { farm_id: farmId },
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
    logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'Commodity', entityId: commodity.id, action: 'create', changes: { name, code, lbs_per_bu: parseFloat(lbs_per_bu) } });
    res.status(201).json({ commodity });
  } catch (err) { next(err); }
});

// GET locations for a farm
router.get('/:farmId/inventory/locations', authenticate, async (req, res, next) => {
  try {
    const { farmId, locationId, hasLocation } = await resolveInventoryFarm(req.params.farmId);
    const isEnterprise = req.query.enterprise === 'true';
    // BU with no inventory location (e.g. Provost) → return empty
    if (!isEnterprise && !hasLocation) return res.json({ locations: [] });
    const where = { farm_id: farmId };
    if (!isEnterprise && locationId) where.id = locationId;
    const locations = await prisma.inventoryLocation.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { bins: true } } },
    });
    res.json({ locations });
  } catch (err) { next(err); }
});

// GET bins with filters
router.get('/:farmId/inventory/bins', authenticate, async (req, res, next) => {
  try {
    const { farmId, locationId, hasLocation } = await resolveInventoryFarm(req.params.farmId);
    const { location, commodity, status, periodId, enterprise } = req.query;
    const isEnterprise = enterprise === 'true';
    // BU with no inventory location (e.g. Provost) → return empty
    if (!isEnterprise && !hasLocation) return res.json({ bins: [], total: 0 });

    const where = { farm_id: farmId, is_active: true };
    // BU-level view: filter to matching location; explicit location filter overrides
    if (location) where.location_id = location;
    else if (!isEnterprise && locationId) where.location_id = locationId;
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
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { location_id, bin_number, bin_type, capacity_bu, commodity_id, notes } = req.body;
    if (!location_id || !bin_number) {
      return res.status(400).json({ error: 'location_id and bin_number are required' });
    }
    const bin = await prisma.inventoryBin.create({
      data: {
        farm_id: farmId, location_id, bin_number,
        bin_type: bin_type || 'hopper',
        capacity_bu: capacity_bu ? parseFloat(capacity_bu) : null,
        commodity_id: commodity_id || null,
        notes: notes || null,
      },
    });
    logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'InventoryBin', entityId: bin.id, action: 'create', changes: { location_id, bin_number, bin_type: bin_type || 'hopper', capacity_bu: capacity_bu ? parseFloat(capacity_bu) : null, commodity_id: commodity_id || null } });
    res.status(201).json({ bin });
  } catch (err) { next(err); }
});

// PUT update bin
router.put('/:farmId/inventory/bins/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { bin_type, capacity_bu, commodity_id, notes, is_active } = req.body;
    const oldBin = await prisma.inventoryBin.findFirst({ where: { id: req.params.id, farm_id: farmId } });
    if (!oldBin) return res.status(404).json({ error: 'Bin not found' });
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
    if (oldBin) {
      const changes = diffChanges(oldBin, bin, ['bin_type', 'capacity_bu', 'commodity_id', 'notes', 'is_active']);
      if (changes) logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'InventoryBin', entityId: bin.id, action: 'update', changes });
    }
    res.json({ bin });
  } catch (err) { next(err); }
});

// GET count history — timeline of all periods with totals and deltas
router.get('/:farmId/inventory/count-history', authenticate, async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);

    const periods = await prisma.countPeriod.findMany({
      where: { farm_id: farmId },
      orderBy: { period_date: 'asc' },
    });

    if (periods.length === 0) return res.json({ periods: [] });

    const history = [];
    let prevTotalMt = null;

    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];

      // Get all bin counts for this period
      const counts = await prisma.binCount.findMany({
        where: { farm_id: farmId, count_period_id: period.id },
        include: {
          commodity: true,
          bin: { include: { location: true } },
        },
      });

      // Aggregate totals (exclude FERT)
      const grainCounts = counts.filter(c => c.commodity && c.commodity.code !== 'FERT');
      const totalKg = grainCounts.reduce((s, c) => s + (c.kg || 0), 0);
      const totalMt = totalKg / 1000;

      // Per-commodity breakdown
      const byCommodity = {};
      for (const c of grainCounts) {
        const name = c.commodity?.name || 'Unknown';
        if (!byCommodity[name]) byCommodity[name] = { name, kg: 0, bins: 0 };
        byCommodity[name].kg += c.kg || 0;
        if (c.bushels > 0) byCommodity[name].bins++;
      }
      const commodities = Object.values(byCommodity)
        .map(c => ({ name: c.name, mt: c.kg / 1000, bins: c.bins }))
        .sort((a, b) => b.mt - a.mt);

      // Per-location breakdown
      const byLocation = {};
      for (const c of grainCounts) {
        const locName = c.bin?.location?.name || 'Unknown';
        if (!byLocation[locName]) byLocation[locName] = { name: locName, kg: 0, bins: 0 };
        byLocation[locName].kg += c.kg || 0;
        if (c.bushels > 0) byLocation[locName].bins++;
      }
      const locations = Object.values(byLocation)
        .map(l => ({ name: l.name, mt: l.kg / 1000, bins: l.bins }))
        .sort((a, b) => b.mt - a.mt);

      // Hauled between this and previous period
      let hauledMt = 0;
      if (i > 0) {
        const prevPeriod = periods[i - 1];
        const deliveries = await prisma.delivery.findMany({
          where: {
            farm_id: farmId,
            delivery_date: { gt: prevPeriod.period_date, lte: period.period_date },
          },
        });
        hauledMt = deliveries.reduce((s, d) => s + (d.mt_delivered || 0), 0);
      }

      // Delta from previous period
      const deltaMt = prevTotalMt !== null ? totalMt - prevTotalMt : null;

      history.push({
        id: period.id,
        period_date: period.period_date,
        crop_year: period.crop_year,
        status: period.status,
        total_mt: Math.round(totalMt * 10) / 10,
        bin_count: counts.length,
        occupied_bins: counts.filter(c => c.bushels > 0).length,
        location_count: Object.keys(byLocation).length,
        delta_mt: deltaMt !== null ? Math.round(deltaMt * 10) / 10 : null,
        hauled_mt: Math.round(hauledMt * 10) / 10,
        commodities,
        locations,
      });

      prevTotalMt = totalMt;
    }

    // Return in reverse chronological order (newest first)
    res.json({ periods: history.reverse() });
  } catch (err) { next(err); }
});

// GET count periods
router.get('/:farmId/inventory/count-periods', authenticate, async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const periods = await prisma.countPeriod.findMany({
      where: { farm_id: farmId },
      orderBy: { period_date: 'desc' },
    });
    res.json({ periods });
  } catch (err) { next(err); }
});

// POST create count period
router.post('/:farmId/inventory/count-periods', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { period_date, crop_year } = req.body;
    if (!period_date) {
      return res.status(400).json({ error: 'period_date is required' });
    }
    const parsedDate = new Date(period_date);

    // Auto-infer crop_year if not provided: Aug-Dec = that year, Jan-Jul = previous year
    const inferredCropYear = crop_year
      ? parseInt(crop_year)
      : (parsedDate.getUTCMonth() >= 7 ? parsedDate.getUTCFullYear() : parsedDate.getUTCFullYear() - 1);

    // Check for duplicate period_date
    const existing = await prisma.countPeriod.findFirst({
      where: { farm_id: farmId, period_date: parsedDate },
    });
    if (existing) {
      return res.status(400).json({ error: 'A count period already exists for this date' });
    }

    const period = await prisma.countPeriod.create({
      data: { farm_id: farmId, period_date: parsedDate, crop_year: inferredCropYear },
    });
    logAudit({ farmId, userId: req.userId, entityType: 'CountPeriod', entityId: period.id, action: 'create', changes: { period_date, crop_year: inferredCropYear } });
    res.status(201).json({ period });
  } catch (err) { next(err); }
});

// PUT update count period (close/reopen)
router.put('/:farmId/inventory/count-periods/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { status } = req.body;
    const oldPeriod = await prisma.countPeriod.findFirst({ where: { id: req.params.id, farm_id: farmId } });
    if (!oldPeriod) return res.status(404).json({ error: 'Count period not found' });
    const period = await prisma.countPeriod.update({
      where: { id: req.params.id },
      data: { status },
    });
    if (oldPeriod) {
      const changes = diffChanges(oldPeriod, period, ['status']);
      if (changes) logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'CountPeriod', entityId: period.id, action: 'update', changes });
    }
    res.json({ period });
  } catch (err) { next(err); }
});

// GET bin counts for a period
router.get('/:farmId/inventory/count-periods/:id/counts', authenticate, async (req, res, next) => {
  try {
    const { farmId, locationId, hasLocation } = await resolveInventoryFarm(req.params.farmId);
    const isEnterprise = req.query.enterprise === 'true';
    if (!isEnterprise && !hasLocation) return res.json({ counts: [] });
    const where = { farm_id: farmId, count_period_id: req.params.id };
    if (!isEnterprise && locationId) where.bin = { location_id: locationId };
    const counts = await prisma.binCount.findMany({
      where,
      include: { bin: { include: { location: true } }, commodity: true },
      orderBy: [{ bin: { location: { name: 'asc' } } }, { bin: { bin_number: 'asc' } }],
    });
    res.json({ counts });
  } catch (err) { next(err); }
});

// POST create submission (draft)
router.post('/:farmId/inventory/submissions', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { count_period_id, location_id } = req.body;
    if (!count_period_id || !location_id) {
      return res.status(400).json({ error: 'count_period_id and location_id are required' });
    }
    const existing = await prisma.countSubmission.findUnique({
      where: { farm_id_count_period_id_location_id: { farm_id: farmId, count_period_id, location_id } },
    });
    const submission = await prisma.countSubmission.upsert({
      where: {
        farm_id_count_period_id_location_id: {
          farm_id: farmId, count_period_id, location_id,
        },
      },
      update: { status: 'draft', submitted_by: req.userId },
      create: {
        farm_id: farmId, count_period_id, location_id,
        status: 'draft', submitted_by: req.userId,
      },
    });
    logAudit({ farmId, userId: req.userId, entityType: 'CountSubmission', entityId: submission.id, action: existing ? 'update' : 'create', changes: existing ? diffChanges(existing, submission, ['status', 'submitted_by']) : { count_period_id, location_id, status: 'draft' }, metadata: { count_period_id, location_id } });
    res.status(201).json({ submission });
  } catch (err) { next(err); }
});

// PUT update submission (save/submit)
router.put('/:farmId/inventory/submissions/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { status, notes } = req.body;
    const oldSub = await prisma.countSubmission.findFirst({ where: { id: req.params.id, farm_id: farmId } });
    if (!oldSub) return res.status(404).json({ error: 'Submission not found' });
    const submission = await prisma.countSubmission.update({
      where: { id: req.params.id },
      data: {
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
        submitted_by: req.userId,
      },
    });
    if (oldSub) {
      const changes = diffChanges(oldSub, submission, ['status', 'notes', 'submitted_by']);
      if (changes) logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'CountSubmission', entityId: submission.id, action: 'update', changes, metadata: { count_period_id: submission.count_period_id, location_id: submission.location_id } });
    }
    res.json({ submission });
  } catch (err) { next(err); }
});

// POST approve submission
router.post('/:farmId/inventory/submissions/:id/approve', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const oldSub = await prisma.countSubmission.findFirst({ where: { id: req.params.id, farm_id: farmId } });
    if (!oldSub) return res.status(404).json({ error: 'Submission not found' });
    const submission = await prisma.countSubmission.update({
      where: { id: req.params.id },
      data: { status: 'approved' },
    });
    logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'CountSubmission', entityId: submission.id, action: 'update', changes: { status: { old: oldSub?.status, new: 'approved' } }, metadata: { count_period_id: submission.count_period_id, location_id: submission.location_id } });
    res.json({ submission });
  } catch (err) { next(err); }
});

// POST reject submission
router.post('/:farmId/inventory/submissions/:id/reject', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { notes } = req.body;
    const oldSub = await prisma.countSubmission.findFirst({ where: { id: req.params.id, farm_id: farmId } });
    if (!oldSub) return res.status(404).json({ error: 'Submission not found' });
    const submission = await prisma.countSubmission.update({
      where: { id: req.params.id },
      data: { status: 'rejected', notes: notes || null },
    });
    logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'CountSubmission', entityId: submission.id, action: 'update', changes: { status: { old: oldSub?.status, new: 'rejected' }, notes: { old: oldSub?.notes, new: notes || null } }, metadata: { count_period_id: submission.count_period_id, location_id: submission.location_id } });
    res.json({ submission });
  } catch (err) { next(err); }
});

// POST bulk upsert bin counts for a period
router.post('/:farmId/inventory/bin-counts/:periodId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
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

    // Fetch existing counts for diff
    const existingCounts = await prisma.binCount.findMany({
      where: { farm_id: farmId, count_period_id: periodId, bin_id: { in: counts.map(c => c.bin_id) } },
    });
    const existingLookup = Object.fromEntries(existingCounts.map(c => [c.bin_id, c]));

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

      const existing = existingLookup[bin_id];
      if (existing) {
        const changes = diffChanges(existing, record, ['commodity_id', 'bushels', 'kg', 'crop_year', 'notes']);
        if (changes) logAudit({ farmId, userId: req.userId, entityType: 'BinCount', entityId: record.id, action: 'update', changes, metadata: { period_id: periodId, bin_id } });
      } else {
        logAudit({ farmId, userId: req.userId, entityType: 'BinCount', entityId: record.id, action: 'create', changes: { bin_id, commodity_id: commodity_id || null, bushels: parseFloat(bushels) || 0, kg }, metadata: { period_id: periodId, bin_id } });
      }

      results.push(record);
    }

    res.json({ counts: results, total: results.length });
  } catch (err) { next(err); }
});

// POST copy bin counts from one period to another
router.post('/:farmId/inventory/count-periods/:id/copy-from/:sourcePeriodId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { id: targetPeriodId, sourcePeriodId } = req.params;

    // Verify target period is open
    const targetPeriod = await prisma.countPeriod.findFirst({ where: { id: targetPeriodId, farm_id: farmId } });
    if (!targetPeriod) return res.status(404).json({ error: 'Target period not found' });
    if (targetPeriod.status === 'closed') return res.status(400).json({ error: 'Target period is closed' });

    // Verify target has no existing counts
    const existingCount = await prisma.binCount.count({ where: { farm_id: farmId, count_period_id: targetPeriodId } });
    if (existingCount > 0) return res.status(400).json({ error: 'Target period already has counts — cannot copy' });

    // Get source counts
    const sourceCounts = await prisma.binCount.findMany({ where: { farm_id: farmId, count_period_id: sourcePeriodId } });
    if (sourceCounts.length === 0) return res.status(400).json({ error: 'Source period has no counts to copy' });

    // Copy counts to target period
    const data = sourceCounts.map(c => ({
      farm_id: farmId,
      count_period_id: targetPeriodId,
      bin_id: c.bin_id,
      commodity_id: c.commodity_id,
      bushels: c.bushels,
      kg: c.kg,
      crop_year: c.crop_year,
      notes: null,
    }));
    const result = await prisma.binCount.createMany({ data });

    logAudit({ farmId, userId: req.userId, entityType: 'CountPeriod', entityId: targetPeriodId, action: 'copy_counts', changes: { source_period_id: sourcePeriodId, counts_copied: result.count } });
    res.json({ copied: result.count });
  } catch (err) { next(err); }
});

// GET audit log (admin/manager only)
router.get('/:farmId/inventory/audit-log', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { entityType, entityId, limit = '50', offset = '0' } = req.query;

    const where = { farm_id: farmId };
    if (entityType) where.entity_type = entityType;
    if (entityId) where.entity_id = entityId;

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { created_at: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ entries, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) { next(err); }
});

// POST import inventory from Excel
router.post('/:farmId/inventory/import', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!req.file.originalname.match(/\.xlsx?$/i)) {
      return res.status(400).json({ error: 'Only .xlsx files are supported' });
    }
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const result = await importInventoryFromExcel(farmId, req.file.buffer, req.file.originalname);

    // Compute change summary: current period vs previous period
    let changes = null;
    try {
      const periods = await prisma.countPeriod.findMany({
        where: { farm_id: farmId },
        orderBy: { period_date: 'desc' },
        take: 2,
      });

      if (periods.length >= 1) {
        const currentPeriod = periods[0];
        const prevPeriod = periods.length >= 2 ? periods[1] : null;

        // Helper to format period label
        const formatLabel = (p) => {
          const d = new Date(p.period_date);
          return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short' });
        };

        // Aggregate bin counts by commodity for a period (exclude FERT)
        const aggregatePeriod = async (periodId) => {
          const counts = await prisma.binCount.findMany({
            where: { farm_id: farmId, count_period_id: periodId },
            include: { commodity: true },
          });
          const byCommodity = {};
          for (const c of counts) {
            if (!c.commodity || c.commodity.code === 'FERT') continue;
            const name = c.commodity.name;
            if (!byCommodity[name]) byCommodity[name] = 0;
            byCommodity[name] += (c.kg || 0) / 1000;
          }
          return byCommodity;
        };

        const currentAgg = await aggregatePeriod(currentPeriod.id);
        const prevAgg = prevPeriod ? await aggregatePeriod(prevPeriod.id) : {};

        // Merge commodity keys from both periods
        const allCommodities = [...new Set([...Object.keys(currentAgg), ...Object.keys(prevAgg)])].sort();

        const commodities = allCommodities.map(name => {
          const current_mt = Math.round((currentAgg[name] || 0) * 10) / 10;
          const previous_mt = Math.round((prevAgg[name] || 0) * 10) / 10;
          const delta_mt = Math.round((current_mt - previous_mt) * 10) / 10;
          return { name, current_mt, previous_mt, delta_mt };
        });

        const total_current_mt = Math.round(commodities.reduce((s, c) => s + c.current_mt, 0) * 10) / 10;
        const total_previous_mt = Math.round(commodities.reduce((s, c) => s + c.previous_mt, 0) * 10) / 10;
        const total_delta_mt = Math.round((total_current_mt - total_previous_mt) * 10) / 10;

        changes = {
          period_label: formatLabel(currentPeriod),
          prev_period_label: prevPeriod ? formatLabel(prevPeriod) : null,
          commodities,
          total_current_mt,
          total_previous_mt,
          total_delta_mt,
        };
      }
    } catch (_) {
      // Non-critical — return result without changes if summary fails
    }

    res.json({ ...result, changes });
  } catch (err) { next(err); }
});

// ─── Bin Grading ─────────────────────────────────────────────────────

// GET all grades (with filters)
router.get('/:farmId/inventory/grades', authenticate, async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { location, commodity, crop_year } = req.query;

    const where = { farm_id: farmId };
    if (crop_year) where.crop_year = parseInt(crop_year, 10);

    const binWhere = {};
    if (location) binWhere.location_id = location;
    if (commodity) binWhere.commodity_id = commodity;

    const grades = await prisma.binGrade.findMany({
      where: {
        ...where,
        bin: Object.keys(binWhere).length > 0 ? binWhere : undefined,
      },
      include: {
        bin: {
          include: {
            location: true,
            commodity: true,
          },
        },
      },
      orderBy: [{ bin: { location: { name: 'asc' } } }, { bin: { bin_number: 'asc' } }],
    });

    const result = grades.map(g => ({
      id: g.id,
      bin_id: g.bin_id,
      bin_number: g.bin.bin_number,
      location_id: g.bin.location_id,
      location_name: g.bin.location.name,
      location_code: g.bin.location.code,
      commodity_name: g.bin.commodity?.name || null,
      commodity_code: g.bin.commodity?.code || null,
      crop_year: g.crop_year,
      grade: g.grade,
      grade_short: g.grade_short,
      variety: g.variety,
      grade_reason: g.grade_reason,
      protein_pct: g.protein_pct,
      moisture_pct: g.moisture_pct,
      dockage_pct: g.dockage_pct,
      test_weight: g.test_weight,
      hvk_pct: g.hvk_pct,
      frost: g.frost,
      inspector_notes: g.inspector_notes,
      source: g.source,
      grade_date: g.grade_date,
      status: g.status,
    }));

    res.json({ grades: result, total: result.length });
  } catch (err) { next(err); }
});

// GET crop years that have grades
router.get('/:farmId/inventory/grades/crop-years', authenticate, async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const years = await prisma.binGrade.groupBy({
      by: ['crop_year'],
      where: { farm_id: farmId },
      orderBy: { crop_year: 'desc' },
    });
    res.json({ crop_years: years.map(y => y.crop_year) });
  } catch (err) { next(err); }
});

// PUT update a single grade
router.put('/:farmId/inventory/grades/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { id } = req.params;
    const {
      grade, grade_short, variety, grade_reason, protein_pct, moisture_pct,
      dockage_pct, test_weight, hvk_pct, frost, inspector_notes, status,
    } = req.body;

    const existing = await prisma.binGrade.findFirst({ where: { id, farm_id: farmId } });
    if (!existing) return res.status(404).json({ error: 'Grade not found' });

    const updated = await prisma.binGrade.update({
      where: { id },
      data: {
        ...(grade !== undefined && { grade }),
        ...(grade_short !== undefined && { grade_short }),
        ...(variety !== undefined && { variety }),
        ...(grade_reason !== undefined && { grade_reason }),
        ...(protein_pct !== undefined && { protein_pct: protein_pct != null ? parseFloat(protein_pct) : null }),
        ...(moisture_pct !== undefined && { moisture_pct: moisture_pct != null ? parseFloat(moisture_pct) : null }),
        ...(dockage_pct !== undefined && { dockage_pct: dockage_pct != null ? parseFloat(dockage_pct) : null }),
        ...(test_weight !== undefined && { test_weight: test_weight != null ? parseFloat(test_weight) : null }),
        ...(hvk_pct !== undefined && { hvk_pct: hvk_pct != null ? parseFloat(hvk_pct) : null }),
        ...(frost !== undefined && { frost }),
        ...(inspector_notes !== undefined && { inspector_notes }),
        ...(status !== undefined && { status }),
      },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

// POST import grades from EFU spreadsheet
router.post('/:farmId/inventory/grades/import', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { importGradesFromEfu } = await import('../services/gradingImportService.js');
    const result = await importGradesFromEfu(farmId, req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (err) { next(err); }
});

// POST import grades - confirm (after preview)
router.post('/:farmId/inventory/grades/import/confirm', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { grades, crop_year } = req.body;
    if (!grades?.length) return res.status(400).json({ error: 'No grades to import' });

    const { confirmGradesImport } = await import('../services/gradingImportService.js');
    const result = await confirmGradesImport(farmId, grades, crop_year);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
