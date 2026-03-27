import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logAudit, diffChanges } from '../services/auditService.js';
import {
  getMarketingDashboard,
  getPositionByCommodity,
  getCommitmentMatrix,
  getDeliveredUnsettled,
  getCropYears,
  getLatestPrices,
  updatePrice,
  createContract,
  updateContractDelivery,
  fulfillContract,
  getContractSettlementSummary,
  computeSellAnalysis,
  buToMtFactor,
  getTerminalContractsForTransfer,
  createTransferAgreementFromTerminal,
  getContractFulfillment,
  getSpotInventoryValue,
  getInventoryValuation,
} from '../services/marketingService.js';
import { broadcastMarketingEvent } from '../socket/handler.js';
import multer from 'multer';
import { extractContractFromPdf, saveExtractedContract, classifyDocumentType } from '../services/contractExtractionService.js';
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

router.get('/:farmId/marketing/spot-value', authenticate, async (req, res, next) => {
  try {
    const data = await getSpotInventoryValue(req.params.farmId);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/marketing/valuation', authenticate, async (req, res, next) => {
  try {
    const data = await getInventoryValuation(req.params.farmId);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/marketing/contract-fulfillment', authenticate, async (req, res, next) => {
  try {
    const data = await getContractFulfillment(req.params.farmId);
    res.json({ contracts: data });
  } catch (err) { next(err); }
});

router.get('/:farmId/marketing/position', authenticate, async (req, res, next) => {
  try {
    const data = await getPositionByCommodity(req.params.farmId);
    res.json({ position: data });
  } catch (err) { next(err); }
});

router.get('/:farmId/marketing/commitment-matrix', authenticate, async (req, res, next) => {
  try {
    const data = await getCommitmentMatrix(req.params.farmId, req.query.crop_year || null);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/marketing/delivered-unsettled', authenticate, async (req, res, next) => {
  try {
    const data = await getDeliveredUnsettled(req.params.farmId, req.query.crop_year || null);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/marketing/crop-years', authenticate, async (req, res, next) => {
  try {
    const cropYears = await getCropYears(req.params.farmId);
    res.json({ cropYears });
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
        linked_terminal_contract: { select: { id: true, contract_number: true } },
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

router.get('/:farmId/marketing/terminal-contracts-for-transfer', authenticate, async (req, res, next) => {
  try {
    const contracts = await getTerminalContractsForTransfer();
    res.json({ contracts });
  } catch (err) { next(err); }
});

router.post('/:farmId/marketing/transfer-agreement-from-terminal', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { terminal_contract_id, grade_prices_json, blend_requirement_json, crop_year } = req.body;
    if (!terminal_contract_id) return res.status(400).json({ error: 'terminal_contract_id required' });
    const { contract, warning } = await createTransferAgreementFromTerminal(
      req.params.farmId,
      terminal_contract_id,
      { grade_prices_json, blend_requirement_json, crop_year, created_by: req.userId }
    );
    logAudit({
      farmId: req.params.farmId, userId: req.userId,
      entityType: 'MarketingContract', entityId: contract.id, action: 'create',
      changes: { source: 'lgx_one_click', contract_number: contract.contract_number, terminal_contract_id },
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

// POST bulk close contracts (admin cutoff tool)
router.post('/:farmId/marketing/contracts/bulk-close', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { ids, notes } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const result = await prisma.marketingContract.updateMany({
      where: {
        id: { in: ids },
        farm_id: req.params.farmId,
        status: { not: 'cancelled' },
      },
      data: {
        status: 'fulfilled',
        notes: notes || 'Closed — prior year cutoff',
      },
    });

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'MarketingContract',
      entityId: 'bulk_close',
      action: 'bulk_close',
      changes: { closed: result.count, requested: ids.length, notes },
    });

    const io = req.app.get('io');
    if (io) broadcastMarketingEvent(io, req.params.farmId, 'marketing:contracts:bulk_closed', { count: result.count });

    res.json({ closed: result.count });
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

// GET settlement summary for a contract (aggregate from linked logistics settlements)
router.get('/:farmId/marketing/contracts/:id/settlement-summary', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.marketingContract.findFirst({ where: { id: req.params.id, farm_id: req.params.farmId } });
    if (!existing) return res.status(404).json({ error: 'Contract not found' });
    const summary = await getContractSettlementSummary(req.params.id);
    res.json(summary);
  } catch (err) { next(err); }
});

router.post('/:farmId/marketing/contracts/:id/fulfill', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const existing = await prisma.marketingContract.findFirst({ where: { id: req.params.id, farm_id: req.params.farmId } });
    if (!existing) return res.status(404).json({ error: 'Contract not found' });
    const contract = await fulfillContract(req.params.id, req.body);

    logAudit({
      farmId: req.params.farmId, userId: req.userId,
      entityType: 'MarketingContract', entityId: req.params.id, action: 'fulfill',
      changes: { settlement_amount: contract.settlement_amount },
    });

    res.json({ contract });
  } catch (err) { next(err); }
});

router.delete('/:farmId/marketing/contracts/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const existing = await prisma.marketingContract.findFirst({
      where: { id: req.params.id, farm_id: farmId },
      include: { deliveries: true },
    });
    if (!existing) return res.status(404).json({ error: 'Contract not found' });

    // ?permanent=true → hard delete (admin only)
    if (req.query.permanent === 'true') {
      // Unlink related records, then delete
      await prisma.delivery.deleteMany({ where: { marketing_contract_id: req.params.id } });
      await prisma.settlement.updateMany({ where: { marketing_contract_id: req.params.id }, data: { marketing_contract_id: null } });
      await prisma.deliveryTicket.updateMany({ where: { marketing_contract_id: req.params.id }, data: { marketing_contract_id: null } });
      await prisma.cashFlowEntry.updateMany({ where: { marketing_contract_id: req.params.id }, data: { marketing_contract_id: null } });
      await prisma.marketingContract.delete({ where: { id: req.params.id } });

      logAudit({
        farmId: req.params.farmId, userId: req.userId,
        entityType: 'MarketingContract', entityId: req.params.id, action: 'permanent_delete',
        changes: { contract_number: existing.contract_number, had_deliveries: existing.deliveries.length },
      });

      return res.json({ deleted: true, contract_number: existing.contract_number });
    }

    // Default: soft cancel
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

// DELETE bulk delete (cancel) contracts — ?permanent=true for hard delete
router.delete('/:farmId/marketing/contracts', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    if (req.query.permanent === 'true') {
      await prisma.delivery.deleteMany({ where: { marketing_contract_id: { in: ids } } });
      await prisma.settlement.updateMany({ where: { marketing_contract_id: { in: ids } }, data: { marketing_contract_id: null } });
      await prisma.deliveryTicket.updateMany({ where: { marketing_contract_id: { in: ids } }, data: { marketing_contract_id: null } });
      await prisma.cashFlowEntry.updateMany({ where: { marketing_contract_id: { in: ids } }, data: { marketing_contract_id: null } });
      const result = await prisma.marketingContract.deleteMany({
        where: { id: { in: ids }, farm_id: farmId },
      });
      logAudit({
        farmId: req.params.farmId, userId: req.userId,
        entityType: 'MarketingContract', entityId: 'bulk_permanent_delete',
        action: 'permanent_delete',
        changes: { deleted: result.count, requested: ids.length },
      });
      return res.json({ deleted: result.count });
    }

    const result = await prisma.marketingContract.updateMany({
      where: { id: { in: ids }, farm_id: farmId },
      data: { status: 'cancelled' },
    });
    logAudit({
      farmId, userId: req.userId,
      entityType: 'MarketingContract', entityId: 'bulk_cancel',
      action: 'cancel',
      changes: { cancelled: result.count, requested: ids.length },
    });
    res.json({ cancelled: result.count });
  } catch (err) { next(err); }
});

// ─── Contract Document Upload/Download ───────────────────────────────

// Upload contract document
router.post('/:farmId/marketing/contracts/:contractId/document', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const contract = await prisma.marketingContract.findFirst({
      where: { id: req.params.contractId, farm_id: req.params.farmId },
    });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    // Save file to uploads/contracts/
    const fs = await import('fs');
    const path = await import('path');
    const uploadDir = path.join(process.cwd(), 'uploads', 'contracts');
    await fs.promises.mkdir(uploadDir, { recursive: true });

    const ext = path.extname(req.file.originalname) || '.pdf';
    const filename = `${contract.id}${ext}`;
    const filepath = path.join(uploadDir, filename);
    await fs.promises.writeFile(filepath, req.file.buffer);

    const documentUrl = `/uploads/contracts/${filename}`;

    await prisma.marketingContract.update({
      where: { id: contract.id },
      data: { contract_document_url: documentUrl },
    });

    logAudit({
      farmId: req.params.farmId, userId: req.userId,
      entityType: 'MarketingContract', entityId: contract.id,
      action: 'upload_document',
      changes: { contract_document_url: documentUrl },
    });

    res.json({ document_url: documentUrl });
  } catch (err) { next(err); }
});

// Delete contract document
router.delete('/:farmId/marketing/contracts/:contractId/document', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const contract = await prisma.marketingContract.findFirst({
      where: { id: req.params.contractId, farm_id: req.params.farmId },
    });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    if (contract.contract_document_url) {
      const fs = await import('fs');
      const path = await import('path');
      const filepath = path.join(process.cwd(), contract.contract_document_url);
      try { await fs.promises.unlink(filepath); } catch { /* file may not exist */ }
    }

    await prisma.marketingContract.update({
      where: { id: contract.id },
      data: { contract_document_url: null },
    });

    res.json({ success: true });
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

    // Step 1: Classify document type (cheap Haiku call)
    let classification;
    try {
      classification = await classifyDocumentType(req.file.buffer);
    } catch { classification = { document_type: 'unknown', confidence: 'low' }; }

    if (classification.document_type === 'settlement' && classification.confidence !== 'low') {
      return res.status(422).json({
        error: 'This appears to be a settlement document, not a purchase contract. Please upload it in the Settlements section instead.',
        code: 'WRONG_DOCUMENT_TYPE',
        classification,
      });
    }

    // Step 2: Extract contract terms
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

    // Include classification in response
    if (classification) extraction._classification = classification;

    // Enrich extraction with computed price conversions for preview
    if (extraction.commodity) {
      try {
        const { buToMtFactor } = await import('../services/marketingService.js');
        // Use same alias logic as saveExtractedContract
        const COMMODITY_ALIASES = {
          'cwrs': 'Spring Wheat', 'hard red spring': 'Spring Wheat', 'soft white spring': 'Spring Wheat',
          'spring wheat': 'Spring Wheat', 'hrs': 'Spring Wheat', 'sws': 'Spring Wheat',
          'cwad': 'Durum', 'durum wheat': 'Durum', 'amber durum': 'Durum',
          'canola': 'Canola', 'nexera': 'Canola',
          'yellow peas': 'Yellow Peas', 'yellow pea': 'Yellow Peas',
          'lentils': 'Lentils', 'small green lentils': 'Lentils SG', 'small red lentils': 'Lentils SR',
          'green lentils': 'Lentils SG', 'red lentils': 'Lentils SR',
          'chickpeas': 'Chickpeas', 'chickpea': 'Chickpeas', 'desi chickpeas': 'Chickpeas',
          'canary seed': 'Canary Seed', 'barley': 'Barley', 'feed barley': 'Barley', 'malt barley': 'Barley',
        };
        const nameLower = extraction.commodity.toLowerCase();
        const aliasMatch = Object.entries(COMMODITY_ALIASES).find(([key]) => nameLower.includes(key));
        const searchTerms = [extraction.commodity, ...(aliasMatch ? [aliasMatch[1]] : [])];
        let commodity = null;
        for (const term of searchTerms) {
          commodity = await prisma.commodity.findFirst({
            where: { farm_id: req.params.farmId, name: { contains: term, mode: 'insensitive' } },
          });
          if (commodity) break;
        }
        if (commodity) {
          const factor = buToMtFactor(commodity.lbs_per_bu);
          const qtyMt = extraction.quantity_mt || 0;
          // Derive $/mt from total value if no unit prices
          if (!extraction.price_per_bu && !extraction.price_per_mt && extraction.total_contract_value && qtyMt > 0) {
            extraction.price_per_mt = Math.round((extraction.total_contract_value / qtyMt) * 100) / 100;
          }
          // Cross-convert
          if (extraction.price_per_bu && !extraction.price_per_mt) {
            extraction.price_per_mt = Math.round(extraction.price_per_bu * factor * 100) / 100;
          } else if (extraction.price_per_mt && !extraction.price_per_bu) {
            extraction.price_per_bu = Math.round((extraction.price_per_mt / factor) * 100) / 100;
          }
        }
      } catch { /* non-critical — preview will just show whatever AI extracted */ }
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

// ─── PDF Export ───────────────────────────────────────────────────

router.post('/:farmId/marketing/contracts/export-pdf', authenticate, async (req, res, next) => {
  try {
    const { farmId: resolvedFarmId } = await resolveInventoryFarm(req.params.farmId);
    const { columns, status } = req.body || {};

    const farm = await prisma.farm.findUnique({ where: { id: resolvedFarmId } });
    const farmName = farm?.name || 'Farm';

    const where = { farm_id: resolvedFarmId };
    if (status) where.status = status;

    const contracts = await prisma.marketingContract.findMany({
      where,
      include: { counterparty: true, commodity: true },
      orderBy: [{ commodity: { name: 'asc' } }, { counterparty: { name: 'asc' } }],
    });

    const { default: PdfPrinter } = await import('pdfmake');
    const { getFontPaths } = await import('../utils/fontPaths.js');
    const printer = new PdfPrinter({ Roboto: getFontPaths() });

    const fmtNum = (v) => v != null ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '0';
    const fmtDollar = (v) => v != null ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '$0';
    const statusLabel = status ? ` — ${status.replace('_', ' ').toUpperCase()}` : '';
    const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    // ─── Compute summary metrics ───
    const active = contracts.filter(c => ['executed', 'in_delivery'].includes(c.status));
    const totalContracted = active.reduce((s, c) => s + (c.contracted_mt || 0), 0);
    const totalDelivered = active.reduce((s, c) => s + (c.delivered_mt || 0), 0);
    const totalRemaining = active.reduce((s, c) => s + (c.remaining_mt || 0), 0);
    const totalValue = contracts.filter(c => c.status !== 'cancelled').reduce((s, c) => s + (c.contract_value || 0), 0);
    const pricedCount = contracts.filter(c => c.pricing_status === 'priced' && c.status !== 'cancelled').length;
    const unpricedCount = contracts.filter(c => c.pricing_status !== 'priced' && c.status !== 'cancelled').length;

    // ─── By-commodity breakdown ───
    const byCommodity = {};
    for (const c of contracts.filter(ct => ct.status !== 'cancelled')) {
      const name = c.commodity?.name || 'Other';
      if (!byCommodity[name]) byCommodity[name] = { contracted: 0, delivered: 0, remaining: 0, value: 0, count: 0 };
      byCommodity[name].contracted += c.contracted_mt || 0;
      byCommodity[name].delivered += c.delivered_mt || 0;
      byCommodity[name].remaining += c.remaining_mt || 0;
      byCommodity[name].value += c.contract_value || 0;
      byCommodity[name].count++;
    }
    const commoditySummary = Object.entries(byCommodity).sort((a, b) => b[1].contracted - a[1].contracted);

    // ─── By-buyer breakdown ───
    const byBuyer = {};
    for (const c of contracts.filter(ct => ct.status !== 'cancelled')) {
      const name = c.counterparty?.name || 'Unknown';
      if (!byBuyer[name]) byBuyer[name] = { contracted: 0, delivered: 0, value: 0, count: 0 };
      byBuyer[name].contracted += c.contracted_mt || 0;
      byBuyer[name].delivered += c.delivered_mt || 0;
      byBuyer[name].value += c.contract_value || 0;
      byBuyer[name].count++;
    }
    const buyerSummary = Object.entries(byBuyer).sort((a, b) => b[1].contracted - a[1].contracted);

    // ─── Status breakdown ───
    const byStatus = {};
    for (const c of contracts) {
      const s = c.status || 'unknown';
      byStatus[s] = (byStatus[s] || 0) + 1;
    }

    // ─── Styling helpers ───
    const colors = { primary: '#1565C0', accent: '#2E7D32', warn: '#E65100', grey: '#757575', lightGrey: '#F5F5F5', headerBg: '#1565C0', headerText: '#FFFFFF' };
    const noBorder = [false, false, false, false];
    const cellPad = { paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4 };

    // ─── KPI summary cards (as a table row) ───
    const kpiCard = (label, value, sub) => ({
      stack: [
        { text: label, fontSize: 7, color: colors.grey, margin: [0, 0, 0, 2] },
        { text: value, fontSize: 16, bold: true, color: colors.primary },
        ...(sub ? [{ text: sub, fontSize: 7, color: colors.grey, margin: [0, 2, 0, 0] }] : []),
      ],
      alignment: 'center',
      margin: [0, 4, 0, 4],
    });

    const kpiTable = {
      table: {
        widths: ['*', '*', '*', '*', '*'],
        body: [[
          kpiCard('Active Contracts', String(active.length), `of ${contracts.length} total`),
          kpiCard('Committed', `${fmtNum(totalContracted)} MT`, ''),
          kpiCard('Hauled', `${fmtNum(totalDelivered)} MT`, totalContracted > 0 ? `${((totalDelivered / totalContracted) * 100).toFixed(0)}% complete` : ''),
          kpiCard('Remaining', `${fmtNum(totalRemaining)} MT`, ''),
          kpiCard('Total Value', fmtDollar(totalValue), `${pricedCount} priced / ${unpricedCount} unpriced`),
        ]],
      },
      layout: {
        hLineWidth: () => 0.5, vLineWidth: () => 0.5,
        hLineColor: () => '#E0E0E0', vLineColor: () => '#E0E0E0',
        ...cellPad,
      },
      margin: [0, 0, 0, 16],
    };

    // ─── Commodity summary table with visual bar ───
    const maxMt = commoditySummary.length > 0 ? commoditySummary[0][1].contracted : 1;
    const commodityTable = {
      table: {
        headerRows: 1,
        widths: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', '*'],
        body: [
          [
            { text: 'Commodity', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder },
            { text: '#', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
            { text: 'Contracted (MT)', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
            { text: 'Delivered (MT)', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
            { text: 'Remaining (MT)', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
            { text: 'Value', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
            { text: 'Progress', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder },
          ],
          ...commoditySummary.map(([name, data], i) => {
            const pct = data.contracted > 0 ? (data.delivered / data.contracted) : 0;
            const barWidth = Math.max(8, Math.round((data.contracted / maxMt) * 120));
            const deliveredWidth = Math.max(0, Math.round(pct * barWidth));
            const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
            return [
              { text: name, bold: true, fontSize: 8, fillColor: bg, border: noBorder },
              { text: String(data.count), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
              { text: fmtNum(data.contracted), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
              { text: fmtNum(data.delivered), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
              { text: fmtNum(data.remaining), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
              { text: fmtDollar(data.value), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
              {
                table: {
                  widths: [deliveredWidth, Math.max(0, barWidth - deliveredWidth)],
                  body: [[
                    { text: '', fillColor: colors.accent, border: noBorder },
                    { text: '', fillColor: '#E0E0E0', border: noBorder },
                  ]],
                },
                layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 3, paddingBottom: () => 3 },
                fillColor: bg,
                border: noBorder,
              },
            ];
          }),
        ],
      },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, ...cellPad },
      margin: [0, 0, 0, 12],
    };

    // ─── Buyer summary table ───
    const buyerTable = {
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto', 'auto', 'auto'],
        body: [
          [
            { text: 'Buyer', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder },
            { text: '#', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
            { text: 'Contracted (MT)', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
            { text: 'Delivered (MT)', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
            { text: 'Value', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
          ],
          ...buyerSummary.map(([name, data], i) => {
            const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
            return [
              { text: name, bold: true, fontSize: 8, fillColor: bg, border: noBorder },
              { text: String(data.count), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
              { text: fmtNum(data.contracted), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
              { text: fmtNum(data.delivered), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
              { text: fmtDollar(data.value), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            ];
          }),
        ],
      },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, ...cellPad },
      margin: [0, 0, 0, 12],
    };

    // ─── Status breakdown (inline) ───
    const statusLine = Object.entries(byStatus)
      .map(([s, count]) => `${s.replace('_', ' ')}: ${count}`)
      .join('   |   ');

    // ─── Main contracts table ───
    const ALL_COLUMNS = {
      contract_number: { label: 'Contract #', get: c => c.contract_number || '' },
      buyer: { label: 'Buyer', get: c => c.counterparty?.name || '' },
      commodity: { label: 'Crop', get: c => c.commodity?.name || '' },
      grade: { label: 'Grade', get: c => c.grade || '' },
      pricing_type: { label: 'Type', get: c => (c.pricing_type || '').charAt(0).toUpperCase() + (c.pricing_type || '').slice(1) },
      contracted_mt: { label: 'Qty (MT)', align: 'right', get: c => fmtNum(c.contracted_mt) },
      delivered_mt: { label: 'Hauled', align: 'right', get: c => fmtNum(c.delivered_mt) },
      remaining_mt: { label: 'Remaining', align: 'right', get: c => fmtNum(c.remaining_mt) },
      pct_complete: { label: '% Done', align: 'right', get: c => c.contracted_mt > 0 ? `${((c.delivered_mt / c.contracted_mt) * 100).toFixed(0)}%` : '0%' },
      price_per_bu: { label: '$/bu', align: 'right', get: c => c.price_per_bu ? `$${c.price_per_bu.toFixed(2)}` : '' },
      price_per_mt: { label: '$/MT', align: 'right', get: c => c.price_per_mt ? `$${fmtNum(c.price_per_mt)}` : '' },
      contract_value: { label: 'Value', align: 'right', get: c => c.contract_value ? fmtDollar(c.contract_value) : '' },
      elevator_site: { label: 'Elevator', get: c => c.elevator_site || '' },
      delivery_window: { label: 'Delivery', get: c => {
        const s = c.delivery_start ? new Date(c.delivery_start).toLocaleDateString('en-CA') : '';
        const e = c.delivery_end ? new Date(c.delivery_end).toLocaleDateString('en-CA') : '';
        return s || e ? `${s} — ${e}` : '';
      }},
      status: { label: 'Status', get: c => (c.status || '').replace('_', ' ') },
      basis_level: { label: 'Basis', align: 'right', get: c => c.basis_level ? `$${c.basis_level.toFixed(2)}` : '' },
      futures_reference: { label: 'Futures', get: c => c.futures_reference || '' },
      crop_year: { label: 'Crop Yr', get: c => c.crop_year || '' },
      notes: { label: 'Notes', get: c => (c.notes || '').substring(0, 60) },
    };

    const defaultCols = ['contract_number', 'buyer', 'commodity', 'grade', 'pricing_type', 'contracted_mt', 'delivered_mt', 'remaining_mt', 'pct_complete', 'price_per_bu', 'price_per_mt', 'contract_value', 'status'];
    const selectedCols = (columns && columns.length > 0 ? columns : defaultCols).filter(k => ALL_COLUMNS[k]);

    const headerRow = selectedCols.map(k => ({
      text: ALL_COLUMNS[k].label, bold: true, fontSize: 7,
      color: colors.headerText, fillColor: colors.headerBg, border: noBorder,
      alignment: ALL_COLUMNS[k].align || 'left',
    }));

    // Sort by delivery_end date (earliest first), nulls last
    const sorted = [...contracts].sort((a, b) => {
      const da = a.delivery_end ? new Date(a.delivery_end).getTime() : Infinity;
      const db = b.delivery_end ? new Date(b.delivery_end).getTime() : Infinity;
      return da - db;
    });

    // Alert threshold: delivery_end within 2 months of today and not fully delivered
    const now = new Date();
    const twoMonths = new Date(now.getFullYear(), now.getMonth() + 2, now.getDate());
    const isUrgent = (c) => {
      if (!c.delivery_end || (c.remaining_mt || 0) <= 0) return false;
      const end = new Date(c.delivery_end);
      return end <= twoMonths && c.status !== 'cancelled' && c.status !== 'delivered';
    };

    const dataRows = sorted.map((c, i) => {
      const urgent = isUrgent(c);
      const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
      return selectedCols.map(k => ({
        text: ALL_COLUMNS[k].get(c), fontSize: 7,
        alignment: ALL_COLUMNS[k].align || 'left',
        fillColor: bg, border: noBorder,
        ...(urgent && k === 'delivery_window' ? { color: '#D32F2F', bold: true } : {}),
      }));
    });

    // Totals row
    const totalsRow = selectedCols.map(k => {
      const base = { bold: true, fontSize: 7, fillColor: '#E8EAF6', border: noBorder };
      if (k === 'contracted_mt') return { ...base, text: fmtNum(sorted.reduce((s, c) => s + (c.contracted_mt || 0), 0)), alignment: 'right' };
      if (k === 'delivered_mt') return { ...base, text: fmtNum(sorted.reduce((s, c) => s + (c.delivered_mt || 0), 0)), alignment: 'right' };
      if (k === 'remaining_mt') return { ...base, text: fmtNum(sorted.reduce((s, c) => s + (c.remaining_mt || 0), 0)), alignment: 'right' };
      if (k === 'contract_value') return { ...base, text: fmtDollar(sorted.reduce((s, c) => s + (c.contract_value || 0), 0)), alignment: 'right' };
      if (k === 'contract_number') return { ...base, text: `${sorted.length} contracts` };
      return { ...base, text: '' };
    });

    // Use auto widths with one '*' column to fill remaining space
    const widths = selectedCols.map((k, i) => i === 0 ? '*' : 'auto');

    const contractsTable = {
      table: {
        headerRows: 1,
        widths,
        body: [headerRow, ...dataRows, totalsRow],
      },
      layout: {
        hLineWidth: () => 0, vLineWidth: () => 0,
        paddingLeft: () => 4, paddingRight: () => 4,
        paddingTop: () => 3, paddingBottom: () => 3,
      },
    };

    // ─── Assemble document ───
    const content = [
      // Title bar
      {
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              { text: farmName.toUpperCase(), fontSize: 9, color: '#FFFFFF', bold: true, margin: [0, 0, 0, 2] },
              { text: `Marketing Contracts Report${statusLabel}`, fontSize: 16, color: '#FFFFFF', bold: true },
              { text: dateStr, fontSize: 8, color: '#B3D4FC' },
            ],
            fillColor: colors.primary,
            border: noBorder,
            margin: [8, 8, 8, 8],
          }]],
        },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
        margin: [0, 0, 0, 14],
      },

      // KPI cards
      kpiTable,

      // Commodity summary (full width)
      { text: 'Summary by Commodity', style: 'sectionHeader' },
      commodityTable,

      // Buyer summary (full width)
      { text: 'Summary by Buyer', style: 'sectionHeader' },
      buyerTable,

      // Status line
      { text: `Status Breakdown:  ${statusLine}`, fontSize: 7, color: colors.grey, margin: [0, 0, 0, 12] },

      // Full contracts table
      { text: 'Contract Details', style: 'sectionHeader' },
      {
        columns: [
          { text: 'Sorted by delivery date (earliest first)', fontSize: 7, color: colors.grey, width: '*' },
          { canvas: [{ type: 'rect', x: 0, y: 0, w: 8, h: 8, color: '#FFCDD2', lineWidth: 0 }], width: 12 },
          { text: ' Delivery due within 2 months — not fully delivered', fontSize: 7, color: '#D32F2F', width: 'auto' },
        ],
        margin: [0, 0, 0, 6],
      },
      contractsTable,

      // Footer note
      { text: `C2 Farms  |  ${contracts.length} contracts  |  Generated ${dateStr}`, fontSize: 6, color: colors.grey, alignment: 'center', margin: [0, 14, 0, 0] },
    ];

    const docDefinition = {
      pageOrientation: 'landscape',
      pageSize: 'LETTER',
      pageMargins: [28, 28, 28, 28],
      content,
      styles: {
        sectionHeader: { fontSize: 10, bold: true, color: colors.primary, margin: [0, 4, 0, 6] },
      },
      defaultStyle: { fontSize: 8 },
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=marketing-contracts.pdf');
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) { next(err); }
});

export default router;
