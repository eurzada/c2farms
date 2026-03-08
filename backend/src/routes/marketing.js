import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logAudit, diffChanges } from '../services/auditService.js';
import {
  getMarketingDashboard,
  getPositionByCommodity,
  getLatestPrices,
  updatePrice,
  createContract,
  updateContractDelivery,
  settleContract,
  computeSellAnalysis,
  buToMtFactor,
} from '../services/marketingService.js';
import { broadcastMarketingEvent } from '../socket/handler.js';
import multer from 'multer';
import { extractContractFromPdf, saveExtractedContract } from '../services/contractExtractionService.js';
import { createExtractionBatch, getBatchStatus, getBatchMeta, clearBatchMeta } from '../services/batchExtractionService.js';
import { resolveInventoryFarm } from '../services/resolveInventoryFarm.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Marketing is enterprise-wide — resolve BU farm → enterprise farm for all routes
router.use('/:farmId/marketing', async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    req.params.farmId = farmId;
    next();
  } catch (err) { next(err); }
});

// ─── Dashboard & Position ────────────────────────────────────────────

router.get('/:farmId/marketing/dashboard', authenticate, async (req, res, next) => {
  try {
    const data = await getMarketingDashboard(req.params.farmId);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/marketing/position', authenticate, async (req, res, next) => {
  try {
    const data = await getPositionByCommodity(req.params.farmId);
    res.json({ position: data });
  } catch (err) { next(err); }
});

// ─── Contracts ───────────────────────────────────────────────────────

router.get('/:farmId/marketing/contracts', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { status, commodity, crop_year } = req.query;

    const where = { farm_id: farmId };
    if (status) where.status = status;
    if (commodity) where.commodity_id = commodity;
    if (crop_year) where.crop_year = crop_year;

    const contracts = await prisma.marketingContract.findMany({
      where,
      include: {
        counterparty: true,
        commodity: true,
        deliveries: { orderBy: { delivery_date: 'desc' } },
      },
      orderBy: { created_at: 'desc' },
    });

    // Enrich with computed fields
    const result = contracts.map(c => {
      const pctComplete = c.contracted_mt > 0 ? (c.delivered_mt / c.contracted_mt) * 100 : 0;
      return { ...c, pct_complete: pctComplete };
    });

    res.json({ contracts: result });
  } catch (err) { next(err); }
});

router.post('/:farmId/marketing/contracts', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { contract, warning } = await createContract(req.params.farmId, {
      ...req.body,
      created_by: req.userId,
    });

    logAudit({
      farmId: req.params.farmId, userId: req.userId,
      entityType: 'MarketingContract', entityId: contract.id, action: 'create',
      changes: { contract_number: contract.contract_number, commodity: contract.commodity?.name, contracted_mt: contract.contracted_mt },
    });

    const io = req.app.get('io');
    if (io) broadcastMarketingEvent(io, req.params.farmId, 'marketing:contract:created', { id: contract.id });

    res.status(201).json({ contract, warning });
  } catch (err) { next(err); }
});

// ─── Batch Contract PDF Import (50% Anthropic discount) ─────────────
// These must be registered BEFORE /:id routes to avoid "import-batch" matching as :id

router.post('/:farmId/marketing/contracts/import-batch', authenticate, requireRole('admin', 'manager'), upload.array('files', 50), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const invalidFiles = req.files.filter(f => !f.originalname.match(/\.(pdf|jpg|jpeg|png)$/i));
    if (invalidFiles.length > 0) {
      return res.status(400).json({ error: `Unsupported file types: ${invalidFiles.map(f => f.originalname).join(', ')}` });
    }

    const files = req.files.map(f => ({ buffer: f.buffer, filename: f.originalname }));
    const result = await createExtractionBatch(req.params.farmId, files);

    logAudit({
      farmId: req.params.farmId, userId: req.userId,
      entityType: 'MarketingContract', entityId: result.batchId,
      action: 'batch_import_started',
      changes: { file_count: files.length, filenames: files.map(f => f.filename) },
    });

    res.status(202).json(result);
  } catch (err) { next(err); }
});

router.get('/:farmId/marketing/contracts/import-batch/:batchId', authenticate, async (req, res, next) => {
  try {
    const meta = getBatchMeta(req.params.batchId);
    if (meta && meta.farmId !== req.params.farmId) {
      return res.status(403).json({ error: 'Batch does not belong to this farm' });
    }
    const status = await getBatchStatus(req.params.batchId);
    res.json(status);
  } catch (err) { next(err); }
});

router.post('/:farmId/marketing/contracts/import-batch/:batchId/confirm', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { extractions } = req.body;
    if (!Array.isArray(extractions) || extractions.length === 0) {
      return res.status(400).json({ error: 'No extractions to confirm' });
    }

    const results = [];
    for (const item of extractions) {
      try {
        const contract = await saveExtractedContract(req.params.farmId, item.extraction);
        results.push({ custom_id: item.custom_id, status: 'created', contract });

        logAudit({
          farmId: req.params.farmId, userId: req.userId,
          entityType: 'MarketingContract', entityId: contract.id,
          action: 'create',
          changes: {
            source: 'batch_import',
            batch_id: req.params.batchId,
            contract_number: contract.contract_number,
            buyer: contract.counterparty?.name,
            commodity: contract.commodity?.name,
          },
        });
      } catch (err) {
        results.push({ custom_id: item.custom_id, status: 'error', error: err.message });
      }
    }

    const io = req.app.get('io');
    if (io) broadcastMarketingEvent(io, req.params.farmId, 'marketing:contracts:batch_imported', {
      count: results.filter(r => r.status === 'created').length,
    });

    clearBatchMeta(req.params.batchId);

    res.json({
      total: extractions.length,
      created: results.filter(r => r.status === 'created').length,
      errors: results.filter(r => r.status === 'error').length,
      results,
    });
  } catch (err) { next(err); }
});

// ─── Contract CRUD (parameterized :id routes) ────────────────────────

router.put('/:farmId/marketing/contracts/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const old = await prisma.marketingContract.findFirst({ where: { id: req.params.id, farm_id: req.params.farmId } });
    if (!old) return res.status(404).json({ error: 'Contract not found' });

    // If price_per_bu changed, recompute price_per_mt and contract_value
    const updateData = { ...req.body };
    if (updateData.price_per_bu !== undefined) {
      const commodity = await prisma.commodity.findUnique({ where: { id: old.commodity_id } });
      const factor = buToMtFactor(commodity.lbs_per_bu);
      updateData.price_per_mt = updateData.price_per_bu * factor;
      updateData.contract_value = updateData.price_per_mt * old.contracted_mt;
    }

    // Clean date fields
    if (updateData.delivery_start) updateData.delivery_start = new Date(updateData.delivery_start);
    if (updateData.delivery_end) updateData.delivery_end = new Date(updateData.delivery_end);

    const contract = await prisma.marketingContract.update({
      where: { id: req.params.id },
      data: updateData,
      include: { counterparty: true, commodity: true },
    });

    const changes = diffChanges(old, contract, ['price_per_bu', 'status', 'pricing_type', 'pricing_status', 'elevator_site', 'notes']);
    if (changes) {
      logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'MarketingContract', entityId: contract.id, action: 'update', changes });
    }

    const io = req.app.get('io');
    if (io) broadcastMarketingEvent(io, req.params.farmId, 'marketing:contract:updated', { id: contract.id });

    res.json({ contract });
  } catch (err) { next(err); }
});

router.post('/:farmId/marketing/contracts/:id/deliveries', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const contract = await prisma.marketingContract.findFirst({ where: { id: req.params.id, farm_id: req.params.farmId } });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    const result = await updateContractDelivery(req.params.id, req.body);

    logAudit({
      farmId: req.params.farmId, userId: req.userId,
      entityType: 'MarketingContract', entityId: req.params.id, action: 'delivery',
      changes: { mt_delivered: req.body.mt_delivered, new_status: result.newStatus },
    });

    const io = req.app.get('io');
    if (io) broadcastMarketingEvent(io, req.params.farmId, 'marketing:delivery:created', { contract_id: req.params.id });

    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/:farmId/marketing/contracts/:id/settle', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const existing = await prisma.marketingContract.findFirst({ where: { id: req.params.id, farm_id: req.params.farmId } });
    if (!existing) return res.status(404).json({ error: 'Contract not found' });
    const contract = await settleContract(req.params.id, req.body);

    logAudit({
      farmId: req.params.farmId, userId: req.userId,
      entityType: 'MarketingContract', entityId: req.params.id, action: 'settle',
      changes: { settlement_amount: contract.settlement_amount },
    });

    res.json({ contract });
  } catch (err) { next(err); }
});

router.delete('/:farmId/marketing/contracts/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await prisma.marketingContract.findFirst({ where: { id: req.params.id, farm_id: req.params.farmId } });
    if (!existing) return res.status(404).json({ error: 'Contract not found' });
    const { notes } = req.body || {};
    const contract = await prisma.marketingContract.update({
      where: { id: req.params.id },
      data: { status: 'cancelled', notes: notes || 'Cancelled' },
    });

    logAudit({
      farmId: req.params.farmId, userId: req.userId,
      entityType: 'MarketingContract', entityId: req.params.id, action: 'cancel',
      changes: { status: 'cancelled', notes },
    });

    res.json({ contract });
  } catch (err) { next(err); }
});

// DELETE bulk delete (cancel) contracts
router.delete('/:farmId/marketing/contracts', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const result = await prisma.marketingContract.updateMany({
      where: { id: { in: ids }, farm_id: req.params.farmId },
      data: { status: 'cancelled' },
    });
    logAudit({
      farmId: req.params.farmId, userId: req.userId,
      entityType: 'MarketingContract', entityId: 'bulk_cancel',
      action: 'cancel',
      changes: { cancelled: result.count, requested: ids.length },
    });
    res.json({ cancelled: result.count });
  } catch (err) { next(err); }
});

// ─── Prices ──────────────────────────────────────────────────────────

router.get('/:farmId/marketing/prices', authenticate, async (req, res, next) => {
  try {
    const prices = await getLatestPrices(req.params.farmId);
    res.json({ prices });
  } catch (err) { next(err); }
});

router.put('/:farmId/marketing/prices/:commodityId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const price = await updatePrice(req.params.farmId, req.params.commodityId, req.body);

    const io = req.app.get('io');
    if (io) broadcastMarketingEvent(io, req.params.farmId, 'marketing:price:updated', { commodity_id: req.params.commodityId });

    res.json({ price });
  } catch (err) { next(err); }
});

// ─── Sell Analysis ───────────────────────────────────────────────────

router.post('/:farmId/marketing/sell-analysis', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const analysis = await computeSellAnalysis(req.params.farmId, req.body);
    res.json({ analysis });
  } catch (err) { next(err); }
});

// ─── Settings ────────────────────────────────────────────────────────

router.get('/:farmId/marketing/settings', authenticate, async (req, res, next) => {
  try {
    const settings = await prisma.marketingSettings.findUnique({ where: { farm_id: req.params.farmId } });
    res.json({ settings: settings || {} });
  } catch (err) { next(err); }
});

router.put('/:farmId/marketing/settings', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const settings = await prisma.marketingSettings.upsert({
      where: { farm_id: req.params.farmId },
      update: req.body,
      create: { farm_id: req.params.farmId, ...req.body },
    });
    res.json({ settings });
  } catch (err) { next(err); }
});

// ─── Contract PDF Import ─────────────────────────────────────────────

// POST upload contract PDF → Claude extracts terms → creates MarketingContract
router.post('/:farmId/marketing/contracts/import-pdf', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.originalname.match(/\.(pdf|jpg|jpeg|png)$/i)) {
      return res.status(400).json({ error: 'Only PDF and image files are supported' });
    }

    let extraction, usage;
    try {
      ({ extraction, usage } = await extractContractFromPdf(req.file.buffer));
    } catch (apiErr) {
      const status = apiErr.code === 'NO_API_KEY' || apiErr.code === 'INVALID_API_KEY' ? 500
        : apiErr.code === 'RATE_LIMITED' ? 429
        : apiErr.code === 'INSUFFICIENT_CREDITS' ? 402
        : apiErr.code === 'API_OVERLOADED' ? 503
        : 422;
      return res.status(status).json({ error: apiErr.message, code: apiErr.code, usage: apiErr.usage || null });
    }

    // Return extraction for preview — don't save yet
    res.json({ extraction, usage });
  } catch (err) { next(err); }
});

// POST check for duplicate contract before confirming
router.post('/:farmId/marketing/contracts/import-pdf/check-duplicate', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { contract_number } = req.body;
    if (!contract_number) return res.json({ duplicate: false });
    const existing = await prisma.marketingContract.findFirst({
      where: { farm_id: req.params.farmId, contract_number },
      include: { counterparty: true, commodity: true },
    });
    if (existing) {
      return res.json({
        duplicate: true,
        existing: {
          id: existing.id,
          contract_number: existing.contract_number,
          buyer: existing.counterparty?.name,
          commodity: existing.commodity?.name,
          contracted_mt: existing.contracted_mt,
          status: existing.status,
          delivered_mt: existing.delivered_mt,
        },
      });
    }
    res.json({ duplicate: false });
  } catch (err) { next(err); }
});

// POST confirm and save extracted contract
router.post('/:farmId/marketing/contracts/import-pdf/confirm', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { extraction, usage } = req.body;
    if (!extraction) return res.status(400).json({ error: 'No extraction data provided' });

    const contract = await saveExtractedContract(req.params.farmId, extraction, usage);

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'MarketingContract',
      entityId: contract.id,
      action: 'create',
      changes: {
        source: 'pdf_import',
        contract_number: contract.contract_number,
        buyer: contract.counterparty?.name,
        commodity: contract.commodity?.name,
        ai_usage: usage,
      },
    });

    const io = req.app.get('io');
    if (io) broadcastMarketingEvent(io, req.params.farmId, 'marketing:contract:created', { id: contract.id });
    res.status(201).json({ contract });
  } catch (err) { next(err); }
});

export default router;
