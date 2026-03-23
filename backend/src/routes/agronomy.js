import { Router } from 'express';
import multer from 'multer';
import { requireRole } from '../middleware/auth.js';
import { authenticate } from '../middleware/auth.js';
import * as svc from '../services/agronomyService.js';
import * as woImport from '../services/workOrderImportService.js';
import * as cwoImport from '../services/cwoImportService.js';
import * as procSvc from '../services/procurementContractService.js';
import * as procImport from '../services/procurementImportService.js';
import prisma from '../config/database.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = Router();

// ─── Cross-farm import routes (mounted at /api/agronomy) ────────────
// These don't require a specific farmId since they operate across farms

export const agronomyGeneralRouter = Router();

agronomyGeneralRouter.get('/template', authenticate, async (req, res, next) => {
  try {
    const wb = await svc.generateTemplate(req.userId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="agronomy-import-template.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

agronomyGeneralRouter.post('/import/preview', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const rows = await svc.parseImportFile(req.file.buffer, req.file.originalname);
    const preview = await svc.previewImport(rows, req.userId);
    // Stash rows in memory for commit (short-lived, keyed by user)
    req.app.locals._agronomyImport = req.app.locals._agronomyImport || {};
    req.app.locals._agronomyImport[req.userId] = { preview, rows, ts: Date.now() };
    res.json(preview);
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    next(err);
  }
});

agronomyGeneralRouter.post('/import/commit', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.body.crop_year);
    if (!cropYear) return res.status(400).json({ error: 'crop_year required' });
    const cached = req.app.locals._agronomyImport?.[req.userId];
    if (!cached || Date.now() - cached.ts > 10 * 60 * 1000) {
      return res.status(400).json({ error: 'No pending import — please upload and preview again' });
    }
    const results = await svc.commitImport(cached.preview, cropYear);
    delete req.app.locals._agronomyImport[req.userId];
    res.json({ success: true, results });
  } catch (err) { next(err); }
});

// Bulk unlock/lock all plans for a crop year (admin only)
agronomyGeneralRouter.post('/bulk-status', authenticate, async (req, res, next) => {
  try {
    const { crop_year, status } = req.body;
    if (!crop_year || !['draft', 'locked'].includes(status)) {
      return res.status(400).json({ error: 'crop_year and status (draft or locked) required' });
    }
    // Verify user is admin on at least one farm
    const { default: prisma } = await import('../config/database.js');
    const adminRole = await prisma.userFarmRole.findFirst({
      where: { user_id: req.userId, role: 'admin' },
    });
    if (!adminRole) return res.status(403).json({ error: 'Admin access required' });

    const result = await svc.bulkUpdatePlanStatus(crop_year, status, req.user?.name || 'admin');
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Work Order Import (Phase A) ────────────────────────────────────

agronomyGeneralRouter.post('/work-orders/preview', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const cropYear = parseInt(req.body.crop_year) || new Date().getFullYear();
    const rows = await woImport.parseWorkOrderExcel(req.file.buffer);
    const preview = await woImport.previewWorkOrderImport(rows, cropYear);
    // Stash for commit
    req.app.locals._woImport = req.app.locals._woImport || {};
    req.app.locals._woImport[req.userId] = { preview, ts: Date.now() };
    res.json(preview);
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    next(err);
  }
});

agronomyGeneralRouter.post('/work-orders/commit', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.body.crop_year);
    if (!cropYear) return res.status(400).json({ error: 'crop_year required' });
    const cached = req.app.locals._woImport?.[req.userId];
    if (!cached || Date.now() - cached.ts > 10 * 60 * 1000) {
      return res.status(400).json({ error: 'No pending import — please upload and preview again' });
    }
    const results = await woImport.commitWorkOrderImport(cached.preview, cropYear, req.userId);
    delete req.app.locals._woImport[req.userId];
    res.json({ success: true, results });
  } catch (err) { next(err); }
});

// ─── Product Library (Phase A) ──────────────────────────────────────

agronomyGeneralRouter.get('/product-library', authenticate, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const type = req.query.type || null;
    const products = await svc.getProductLibrary(year, type);
    res.json(products);
  } catch (err) { next(err); }
});

agronomyGeneralRouter.patch('/product-library/:id', authenticate, async (req, res, next) => {
  try {
    const allowed = ['unit_price', 'packaging_unit', 'packaging_volume', 'cost_per_application_unit',
      'dealer_code', 'dealer_name', 'name', 'type', 'analysis_code', 'form'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    // Recompute cost_per_application_unit if price or volume changed
    if (data.unit_price !== undefined || data.packaging_volume !== undefined) {
      const existing = await prisma.agroProduct.findUnique({ where: { id: req.params.id } });
      if (existing) {
        const price = data.unit_price ?? existing.unit_price;
        const vol = data.packaging_volume ?? existing.packaging_volume;
        if (price && vol) data.cost_per_application_unit = price / vol;
      }
    }
    const product = await prisma.agroProduct.update({ where: { id: req.params.id }, data });
    res.json(product);
  } catch (err) { next(err); }
});

// ─── CWO Import (Phase B) ──────────────────────────────────────────

agronomyGeneralRouter.post('/cwo/preview', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const cropYear = parseInt(req.body.crop_year) || new Date().getFullYear();

    const rows = await cwoImport.parseCwoExcel(req.file.buffer);
    const fieldGroups = cwoImport.extractFieldGroups(rows);

    // Load saved mappings
    const savedMappings = await prisma.cwoFieldGroupMapping.findMany({
      where: { crop_year: cropYear },
    });
    const mappings = {};
    for (const m of savedMappings) mappings[m.field_group] = m.farm_id;

    // If custom mappings sent in body, merge
    if (req.body.field_group_mappings) {
      try {
        const custom = JSON.parse(req.body.field_group_mappings);
        Object.assign(mappings, custom);
      } catch { /* ignore parse errors */ }
    }

    const preview = await cwoImport.previewCwoImport(rows, cropYear, mappings);

    // Stash for commit
    req.app.locals._cwoImport = req.app.locals._cwoImport || {};
    req.app.locals._cwoImport[req.userId] = { preview, rows, ts: Date.now() };

    res.json({ ...preview, field_groups: fieldGroups, saved_mappings: mappings });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    next(err);
  }
});

agronomyGeneralRouter.post('/cwo/commit', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.body.crop_year);
    const label = req.body.label || '';
    if (!cropYear) return res.status(400).json({ error: 'crop_year required' });

    const cached = req.app.locals._cwoImport?.[req.userId];
    if (!cached || Date.now() - cached.ts > 10 * 60 * 1000) {
      return res.status(400).json({ error: 'No pending import — please upload and preview again' });
    }

    // If updated mappings sent, re-preview with new mappings
    let preview = cached.preview;
    if (req.body.field_group_mappings) {
      try {
        const mappings = JSON.parse(req.body.field_group_mappings);
        preview = await cwoImport.previewCwoImport(cached.rows, cropYear, mappings);
      } catch { /* use cached preview */ }
    }

    const results = await cwoImport.commitCwoImport(preview, cropYear, label, req.userId);
    delete req.app.locals._cwoImport[req.userId];
    res.json({ success: true, results });
  } catch (err) { next(err); }
});

// ─── Field Group Mappings ──────────────────────────────────────────

agronomyGeneralRouter.get('/field-group-mappings', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.query.year) || new Date().getFullYear();
    const mappings = await prisma.cwoFieldGroupMapping.findMany({
      where: { crop_year: cropYear },
      include: { farm: { select: { id: true, name: true } } },
    });
    res.json(mappings);
  } catch (err) { next(err); }
});

agronomyGeneralRouter.post('/field-group-mappings', authenticate, async (req, res, next) => {
  try {
    const { mappings, crop_year } = req.body;
    if (!Array.isArray(mappings) || !crop_year) {
      return res.status(400).json({ error: 'mappings array and crop_year required' });
    }

    const results = [];
    for (const { field_group, farm_id } of mappings) {
      if (!field_group || !farm_id) continue;
      const result = await prisma.cwoFieldGroupMapping.upsert({
        where: { field_group_crop_year: { field_group, crop_year } },
        update: { farm_id },
        create: { field_group, farm_id, crop_year },
      });
      results.push(result);
    }
    res.json({ updated: results.length });
  } catch (err) { next(err); }
});

// ─── Snapshots ─────────────────────────────────────────────────────

agronomyGeneralRouter.get('/snapshots', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.query.year) || new Date().getFullYear();
    const snapshots = await prisma.cwoImportSnapshot.findMany({
      where: { crop_year: cropYear },
      orderBy: { created_at: 'desc' },
    });
    res.json(snapshots);
  } catch (err) { next(err); }
});

// ─── Consolidated Procurement (Phase C) ────────────────────────────

agronomyGeneralRouter.get('/wo-matrix', authenticate, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const result = await svc.getWorkOrderMatrix(year);
    res.json(result);
  } catch (err) { next(err); }
});

agronomyGeneralRouter.get('/consolidated-procurement', authenticate, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const result = await svc.getConsolidatedProcurement(year);
    res.json(result);
  } catch (err) { next(err); }
});

agronomyGeneralRouter.get('/plan-vs-booked', authenticate, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const { getPlanVsBooked } = await import('../services/planVsBookedService.js');
    const result = await getPlanVsBooked(year);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Procurement Contracts ──────────────────────────────────────────

async function resolveEnterpriseFarmId() {
  const ent = await prisma.farm.findFirst({ where: { is_enterprise: true } });
  if (!ent) throw Object.assign(new Error('Enterprise farm not found'), { status: 404 });
  return ent.id;
}

agronomyGeneralRouter.get('/procurement-contracts', authenticate, async (req, res, next) => {
  try {
    const farmId = await resolveEnterpriseFarmId();
    const contracts = await procSvc.getContracts(farmId, {
      cropYear: req.query.crop_year,
      status: req.query.status,
      category: req.query.category,
      buFarmId: req.query.bu,
      search: req.query.search,
    });
    res.json(contracts);
  } catch (err) { next(err); }
});

agronomyGeneralRouter.get('/procurement-contracts/:id', authenticate, async (req, res, next) => {
  try {
    const farmId = await resolveEnterpriseFarmId();
    const contract = await procSvc.getContractById(farmId, req.params.id);
    res.json(contract);
  } catch (err) { next(err); }
});

agronomyGeneralRouter.post('/procurement-contracts', authenticate, async (req, res, next) => {
  try {
    const farmId = await resolveEnterpriseFarmId();
    const contract = await procSvc.createContract(farmId, req.body);
    res.status(201).json(contract);
  } catch (err) { next(err); }
});

agronomyGeneralRouter.patch('/procurement-contracts/:id', authenticate, async (req, res, next) => {
  try {
    const farmId = await resolveEnterpriseFarmId();
    const contract = await procSvc.updateContract(farmId, req.params.id, req.body);
    res.json(contract);
  } catch (err) { next(err); }
});

agronomyGeneralRouter.delete('/procurement-contracts/:id', authenticate, async (req, res, next) => {
  try {
    const farmId = await resolveEnterpriseFarmId();
    await procSvc.deleteContract(farmId, req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

agronomyGeneralRouter.patch('/procurement-contract-lines/:lineId', authenticate, async (req, res, next) => {
  try {
    const line = await procSvc.updateLine(req.params.lineId, req.body);
    res.json(line);
  } catch (err) { next(err); }
});

agronomyGeneralRouter.get('/procurement-kpis', authenticate, async (req, res, next) => {
  try {
    const farmId = await resolveEnterpriseFarmId();
    const cropYear = parseInt(req.query.crop_year) || new Date().getFullYear();
    const kpis = await procSvc.getDashboardKPIs(farmId, cropYear);
    res.json(kpis);
  } catch (err) { next(err); }
});

agronomyGeneralRouter.post('/procurement-contracts/import/preview', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const cropYear = parseInt(req.body.crop_year) || new Date().getFullYear();
    const parsed = await procImport.parseProcurementExcel(req.file.buffer);
    const preview = await procImport.previewProcurementImport(parsed, cropYear);
    // Stash for commit
    req.app.locals._procImport = req.app.locals._procImport || {};
    req.app.locals._procImport[req.userId] = { preview, ts: Date.now() };
    res.json(preview);
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    next(err);
  }
});

agronomyGeneralRouter.post('/procurement-contracts/import/commit', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.body.crop_year);
    if (!cropYear) return res.status(400).json({ error: 'crop_year required' });
    const cached = req.app.locals._procImport?.[req.userId];
    if (!cached || Date.now() - cached.ts > 10 * 60 * 1000) {
      return res.status(400).json({ error: 'No pending import — please upload and preview again' });
    }
    const results = await procImport.commitProcurementImport(cached.preview, cropYear, req.userId);
    delete req.app.locals._procImport[req.userId];
    res.json({ success: true, results });
  } catch (err) { next(err); }
});

// ─── Sync Contract Pricing → Product Library ──────────────────────

agronomyGeneralRouter.post('/sync-contract-pricing', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.query.crop_year || req.body.crop_year) || new Date().getFullYear();
    const farmId = await resolveEnterpriseFarmId();
    const result = await procSvc.syncContractPricingToLibrary(farmId, cropYear);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ─── Crop Options ────────────────────────────────────────────────────

agronomyGeneralRouter.get('/crop-options', authenticate, async (req, res, next) => {
  try {
    const result = await svc.getCropOptions();
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Plans ──────────────────────────────────────────────────────────

router.get('/:farmId/agronomy/plans', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const plan = await svc.getPlan(req.params.farmId, year);
    res.json(plan || null);
  } catch (err) { next(err); }
});

router.post('/:farmId/agronomy/plans', requireRole('manager'), async (req, res, next) => {
  try {
    const year = parseInt(req.body.crop_year);
    if (!year) return res.status(400).json({ error: 'crop_year required' });
    const plan = await svc.createPlan(req.params.farmId, year, {
      prepared_by: req.user.name,
      notes: req.body.notes,
    });
    res.status(201).json(plan);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Plan already exists for this crop year' });
    next(err);
  }
});

router.patch('/:farmId/agronomy/plans/:planId/status', requireRole('manager'), async (req, res, next) => {
  try {
    const { status, rejection_notes } = req.body;
    const allowed = ['draft', 'submitted', 'approved', 'locked', 'rejected'];
    if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });

    // Only admin can approve, lock, reject, or unlock (revert to draft)
    if (['approved', 'locked', 'rejected'].includes(status) && req.farmRole !== 'admin') {
      return res.status(403).json({ error: 'Only admin can approve, reject, or lock plans' });
    }

    // Unlock: only admin can revert approved/locked back to draft
    if (status === 'draft') {
      const currentPlan = await svc.getPlanById(req.params.planId);
      if (currentPlan && ['approved', 'locked'].includes(currentPlan.status) && req.farmRole !== 'admin') {
        return res.status(403).json({ error: 'Only admin can unlock plans' });
      }
    }

    if (status === 'rejected' && !rejection_notes) {
      return res.status(400).json({ error: 'Rejection notes are required' });
    }

    const plan = await svc.updatePlanStatus(req.params.planId, status, req.user.name, {
      rejectionNotes: rejection_notes,
      userEmail: req.user.email,
    });

    // On approval, push input costs to Forecast module
    let forecastResult = null;
    if (status === 'approved') {
      try {
        forecastResult = await svc.pushToForecast(req.params.farmId, plan.crop_year);
      } catch (forecastErr) {
        console.error('Forecast push failed:', forecastErr.message);
        forecastResult = { pushed: false, reason: forecastErr.message };
      }
    }

    // On rejection, notify the submitter (email stub — logs for now)
    if (status === 'rejected' && plan.submitted_by) {
      console.log(`[NOTIFICATION] Plan rejected — notify ${plan.submitted_by}: "${rejection_notes}"`);
      // TODO: Send email when email service is configured
      // await sendEmail(plan.submitted_by, 'Agronomy Plan Rejected', `Your plan was rejected: ${rejection_notes}`);
    }

    res.json({ ...plan, forecastSync: forecastResult });
  } catch (err) { next(err); }
});

// ─── Allocations ────────────────────────────────────────────────────

router.get('/:farmId/agronomy/plans/:planId/allocations', async (req, res, next) => {
  try {
    const plan = await svc.getPlan(req.params.farmId, 0); // unused, fetch by planId
    // Direct query since we have planId
    const { PrismaClient } = await import('@prisma/client');
    const prisma = (await import('../config/database.js')).default;
    const allocations = await prisma.cropAllocation.findMany({
      where: { plan_id: req.params.planId },
      orderBy: { sort_order: 'asc' },
      include: { inputs: { orderBy: { sort_order: 'asc' } } },
    });
    res.json(allocations);
  } catch (err) { next(err); }
});

router.post('/:farmId/agronomy/plans/:planId/allocations', requireRole('manager'), async (req, res, next) => {
  try {
    const alloc = await svc.upsertAllocation(req.params.planId, req.body);
    res.status(201).json(alloc);
  } catch (err) { next(err); }
});

router.patch('/:farmId/agronomy/allocations/:id', requireRole('manager'), async (req, res, next) => {
  try {
    const alloc = await svc.upsertAllocation(null, { id: req.params.id, ...req.body });
    res.json(alloc);
  } catch (err) { next(err); }
});

// POST copy inputs from another allocation
router.post('/:farmId/agronomy/allocations/:id/copy-inputs', requireRole('manager'), async (req, res, next) => {
  try {
    const { sourceAllocId } = req.body;
    if (!sourceAllocId) return res.status(400).json({ error: 'sourceAllocId required' });
    const alloc = await svc.copyInputs(sourceAllocId, req.params.id);
    res.json(alloc);
  } catch (err) { next(err); }
});

router.delete('/:farmId/agronomy/allocations/:id', requireRole('manager'), async (req, res, next) => {
  try {
    await svc.deleteAllocation(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── Inputs ─────────────────────────────────────────────────────────

router.post('/:farmId/agronomy/allocations/:allocId/inputs', requireRole('manager'), async (req, res, next) => {
  try {
    const input = await svc.upsertInput(req.params.allocId, req.body);
    res.status(201).json(input);
  } catch (err) { next(err); }
});

router.patch('/:farmId/agronomy/inputs/:id', requireRole('manager'), async (req, res, next) => {
  try {
    const input = await svc.upsertInput(null, { id: req.params.id, ...req.body });
    res.json(input);
  } catch (err) { next(err); }
});

router.delete('/:farmId/agronomy/inputs/:id', requireRole('manager'), async (req, res, next) => {
  try {
    await svc.deleteInput(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── Bulk Fertilizer Save ───────────────────────────────────────────

router.put('/:farmId/agronomy/allocations/:allocId/fertilizers', requireRole('manager'), async (req, res, next) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
    const result = await svc.bulkSaveFertilizers(req.params.allocId, rows);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Nutrients ──────────────────────────────────────────────────────

router.get('/:farmId/agronomy/nutrients/:allocId', async (req, res, next) => {
  try {
    const prisma = (await import('../config/database.js')).default;
    const alloc = await prisma.cropAllocation.findUnique({
      where: { id: req.params.allocId },
      include: { inputs: true },
    });
    if (!alloc) return res.status(404).json({ error: 'Allocation not found' });
    const fertInputs = alloc.inputs.filter(i => i.category === 'fertilizer');
    const balance = svc.computeNutrientBalance(alloc, fertInputs);
    res.json(balance);
  } catch (err) { next(err); }
});

// ─── Dashboard & Reports ────────────────────────────────────────────

router.get('/:farmId/agronomy/dashboard', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const dashboard = await svc.getExecutiveDashboard(req.params.farmId, year);
    if (!dashboard) return res.json(null);
    res.json(dashboard);
  } catch (err) { next(err); }
});

router.get('/:farmId/agronomy/procurement', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const summary = await svc.getProcurementSummary(req.params.farmId, year);
    res.json(summary || []);
  } catch (err) { next(err); }
});

// ─── Apply Pricing (Phase C) ────────────────────────────────────────

router.post('/:farmId/agronomy/apply-pricing', requireRole('manager'), async (req, res, next) => {
  try {
    const year = parseInt(req.body.crop_year) || new Date().getFullYear();
    const result = await svc.applyPricing(req.params.farmId, year);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:farmId/agronomy/cost-coverage', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const result = await svc.getCostCoverage(req.params.farmId, year);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Products (Reference Data) ──────────────────────────────────────

router.get('/:farmId/agronomy/products', async (req, res, next) => {
  try {
    const products = await svc.getProducts(req.params.farmId, req.query.type);
    res.json(products);
  } catch (err) { next(err); }
});

router.post('/:farmId/agronomy/products', requireRole('manager'), async (req, res, next) => {
  try {
    const product = await svc.upsertProduct(req.params.farmId, req.body);
    res.status(201).json(product);
  } catch (err) { next(err); }
});

router.patch('/:farmId/agronomy/products/:id', requireRole('manager'), async (req, res, next) => {
  try {
    const product = await svc.upsertProduct(req.params.farmId, { id: req.params.id, ...req.body });
    res.json(product);
  } catch (err) { next(err); }
});

router.delete('/:farmId/agronomy/products/:id', requireRole('manager'), async (req, res, next) => {
  try {
    await svc.deleteProduct(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

export default router;
