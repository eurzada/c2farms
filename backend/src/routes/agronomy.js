import { Router } from 'express';
import multer from 'multer';
import { requireRole } from '../middleware/auth.js';
import { authenticate } from '../middleware/auth.js';
import * as svc from '../services/agronomyService.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
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
    const { status } = req.body;
    const allowed = ['draft', 'submitted', 'approved', 'locked'];
    if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    // Only admin can approve or lock
    if ((status === 'approved' || status === 'locked') && req.farmRole !== 'admin') {
      return res.status(403).json({ error: 'Only admin can approve or lock plans' });
    }
    const plan = await svc.updatePlanStatus(req.params.planId, status, req.user.name);
    res.json(plan);
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
