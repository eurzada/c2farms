import { Router } from 'express';
import multer from 'multer';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { extractSettlementFromPdf, saveSettlement, queueBatchExtraction, checkBatchStatus } from '../services/settlementService.js';
import { reconcileSettlement, manualMatch, approveSettlement } from '../services/reconciliationAiService.js';
import { logAudit } from '../services/auditService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// GET all settlements for a farm
router.get('/:farmId/settlements', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { status, counterparty_id, limit = '50', offset = '0' } = req.query;

    const where = { farm_id: farmId };
    if (status) where.status = status;
    if (counterparty_id) where.counterparty_id = counterparty_id;

    const [settlements, total] = await Promise.all([
      prisma.settlement.findMany({
        where,
        include: {
          counterparty: { select: { name: true, short_code: true } },
          marketing_contract: { select: { contract_number: true, commodity: { select: { name: true } } } },
          _count: { select: { lines: true } },
        },
        orderBy: { created_at: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.settlement.count({ where }),
    ]);

    res.json({ settlements, total });
  } catch (err) { next(err); }
});

// GET single settlement with lines
router.get('/:farmId/settlements/:id', authenticate, async (req, res, next) => {
  try {
    const settlement = await prisma.settlement.findFirst({
      where: { id: req.params.id, farm_id: req.params.farmId },
      include: {
        counterparty: true,
        marketing_contract: { include: { commodity: true, counterparty: true } },
        lines: {
          include: {
            delivery_ticket: {
              include: {
                commodity: { select: { name: true } },
                location: { select: { name: true } },
              },
            },
          },
          orderBy: { line_number: 'asc' },
        },
      },
    });
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });
    res.json({ settlement });
  } catch (err) { next(err); }
});

// POST upload and extract settlement PDF
router.post('/:farmId/settlements/upload', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.originalname.match(/\.(pdf|jpg|jpeg|png)$/i)) {
      return res.status(400).json({ error: 'Only PDF and image files are supported' });
    }

    const { buyer_format } = req.body; // optional: force buyer format

    // Extract data from PDF using Claude
    let extraction, buyerFormat, usage;
    try {
      ({ extraction, buyerFormat, usage } = await extractSettlementFromPdf(
        req.file.buffer,
        buyer_format || null
      ));
    } catch (apiErr) {
      // Return structured error with usage if available
      const status = apiErr.code === 'NO_API_KEY' || apiErr.code === 'INVALID_API_KEY' ? 500
        : apiErr.code === 'RATE_LIMITED' ? 429
        : apiErr.code === 'INSUFFICIENT_CREDITS' ? 402
        : apiErr.code === 'API_OVERLOADED' ? 503
        : 422;
      return res.status(status).json({
        error: apiErr.message,
        code: apiErr.code,
        usage: apiErr.usage || null,
      });
    }

    // Save to database
    const settlement = await saveSettlement(
      req.params.farmId,
      extraction,
      buyerFormat,
      { usage }
    );

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'Settlement',
      entityId: settlement.id,
      action: 'create',
      changes: {
        settlement_number: settlement.settlement_number,
        buyer_format: buyerFormat,
        lines_extracted: settlement.lines.length,
        ai_usage: usage,
      },
    });

    res.status(201).json({ settlement, extraction, buyer_format: buyerFormat, usage });
  } catch (err) { next(err); }
});

// ─── Batch API (50% cheaper) ─────────────────────────────────────────

// POST batch upload — multiple PDFs queued for batch extraction
router.post('/:farmId/settlements/batch-upload', authenticate, requireRole('admin', 'manager'), upload.array('files', 20), async (req, res, next) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });

    const files = req.files.map(f => ({
      buffer: f.buffer,
      filename: f.originalname,
      buyerFormat: null, // auto-detect
    }));

    const result = await queueBatchExtraction(req.params.farmId, files);

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'AiBatch',
      entityId: result.batch_id,
      action: 'create',
      changes: { total_files: files.length, filenames: files.map(f => f.filename) },
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.code) {
      const status = err.code === 'NO_API_KEY' || err.code === 'INVALID_API_KEY' ? 500
        : err.code === 'INSUFFICIENT_CREDITS' ? 402 : 422;
      return res.status(status).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

// GET batch status — poll for completion
router.get('/:farmId/settlements/batch/:batchId', authenticate, async (req, res, next) => {
  try {
    const result = await checkBatchStatus(req.params.batchId);
    res.json(result);
  } catch (err) { next(err); }
});

// GET all batches for a farm
router.get('/:farmId/settlements/batches', authenticate, async (req, res, next) => {
  try {
    const batches = await prisma.aiBatch.findMany({
      where: { farm_id: req.params.farmId },
      include: {
        settlements: {
          select: { id: true, settlement_number: true, extraction_status: true, buyer_format: true, total_amount: true },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 20,
    });
    res.json(batches);
  } catch (err) { next(err); }
});

// POST run AI reconciliation on a settlement
router.post('/:farmId/settlements/:id/reconcile', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const settlement = await prisma.settlement.findFirst({
      where: { id: req.params.id, farm_id: req.params.farmId },
    });
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });

    const result = await reconcileSettlement(req.params.id);

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'Settlement',
      entityId: req.params.id,
      action: 'reconcile',
      changes: result.summary,
    });

    res.json(result);
  } catch (err) { next(err); }
});

// POST manual match a settlement line to a ticket
router.post('/:farmId/settlements/:id/lines/:lineId/match', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { ticket_id, notes } = req.body;
    if (!ticket_id) return res.status(400).json({ error: 'ticket_id is required' });

    // Verify line belongs to settlement and settlement belongs to farm
    const line = await prisma.settlementLine.findFirst({
      where: { id: req.params.lineId },
      include: { settlement: true },
    });
    if (!line || line.settlement.farm_id !== req.params.farmId || line.settlement.id !== req.params.id) {
      return res.status(404).json({ error: 'Settlement line not found' });
    }

    const result = await manualMatch(req.params.lineId, ticket_id, notes);

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'SettlementLine',
      entityId: req.params.lineId,
      action: 'manual_match',
      changes: { ticket_id, notes },
    });

    res.json({ line: result });
  } catch (err) { next(err); }
});

// POST approve settlement (all lines must be resolved)
router.post('/:farmId/settlements/:id/approve', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const settlement = await prisma.settlement.findFirst({
      where: { id: req.params.id, farm_id: req.params.farmId },
    });
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });

    const result = await approveSettlement(req.params.id);

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'Settlement',
      entityId: req.params.id,
      action: 'approve',
      changes: { status: 'approved' },
    });

    res.json({ settlement: result });
  } catch (err) { next(err); }
});

// PATCH update settlement status/notes
router.patch('/:farmId/settlements/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const settlement = await prisma.settlement.findFirst({
      where: { id: req.params.id, farm_id: req.params.farmId },
    });
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });

    const updated = await prisma.settlement.update({
      where: { id: req.params.id },
      data: {
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
      },
      include: {
        counterparty: true,
        lines: { orderBy: { line_number: 'asc' } },
      },
    });

    res.json({ settlement: updated });
  } catch (err) { next(err); }
});

// POST import contracts from Excel
router.post('/:farmId/settlements/import-contracts', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.originalname.match(/\.xlsx?$/i)) {
      return res.status(400).json({ error: 'Only .xlsx files are supported' });
    }

    const { previewContractImport, commitContractImport } = await import('../services/contractImportService.js');
    const { action = 'preview', crop_year } = req.body;

    if (action === 'preview') {
      const result = await previewContractImport(req.params.farmId, req.file.buffer);
      return res.json(result);
    }

    // Commit
    const preview = await previewContractImport(req.params.farmId, req.file.buffer);
    const result = await commitContractImport(req.params.farmId, preview.contracts, {
      cropYear: crop_year || '2025/26',
    });

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'MarketingContract',
      entityId: 'bulk_import',
      action: 'import',
      changes: result,
    });

    res.json(result);
  } catch (err) { next(err); }
});

export default router;
