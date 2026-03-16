import { Router } from 'express';
import multer from 'multer';
import PdfPrinter from 'pdfmake';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { extractSettlementFromPdf, saveSettlement, queueBatchExtraction, checkBatchStatus } from '../services/settlementService.js';
import { reconcileSettlement, manualMatch, approveSettlement } from '../services/reconciliationAiService.js';
import { generateExceptionExcel, generateExceptionPdf } from '../services/settlementExportService.js';
import { generateReconGapData, generateReconGapExcel, generateReconGapPdf, generateReconGapCsv } from '../services/reconGapReportService.js';
import { getMonthlyReconciliation } from '../services/monthlyReconService.js';
import { getSettlementsByFarmUnit, generateFarmUnitExcel } from '../services/farmUnitReportService.js';
import { getEnterpriseJournal, generateEnterpriseJournalCsv, generateEnterpriseJournalExcel, generateEnterpriseJournalPdf } from '../services/enterpriseJournalService.js';
import { logAudit } from '../services/auditService.js';
import { broadcastMarketingEvent } from '../socket/handler.js';
import { getFontPaths } from '../utils/fontPaths.js';
import { resolveInventoryFarm } from '../services/resolveInventoryFarm.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const printer = new PdfPrinter({ Roboto: getFontPaths() });

// Logistics is enterprise-wide — resolve BU farm → enterprise farm
router.use('/:farmId/settlements', async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    req.params.farmId = farmId;
    next();
  } catch (err) { next(err); }
});

// GET all settlements for a farm
router.get('/:farmId/settlements', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { status, counterparty_id, fiscal_year, limit = '50', offset = '0' } = req.query;

    const where = { farm_id: farmId };
    if (status) where.status = status;
    if (counterparty_id) where.counterparty_id = counterparty_id;
    if (fiscal_year) {
      const fy = parseInt(fiscal_year);
      if (fy) {
        where.settlement_date = {
          gte: new Date(`${fy - 1}-11-01T00:00:00Z`),
          lt: new Date(`${fy}-11-01T00:00:00Z`),
        };
      }
    }

    const [settlements, total, mtAgg] = await Promise.all([
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
      prisma.settlementLine.aggregate({
        where: { settlement: where },
        _sum: { net_weight_mt: true },
      }),
    ]);

    res.json({ settlements, total, total_mt: mtAgg._sum.net_weight_mt || 0 });
  } catch (err) { next(err); }
});

// GET missing contracts report — settlements referencing contracts not in the system
router.get('/:farmId/settlements/reports/missing-contracts', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;

    // Find settlements with no linked marketing contract
    const settlements = await prisma.settlement.findMany({
      where: { farm_id: farmId, marketing_contract_id: null },
      select: {
        id: true,
        settlement_number: true,
        settlement_date: true,
        total_amount: true,
        status: true,
        buyer_format: true,
        extraction_json: true,
        counterparty: { select: { name: true, short_code: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { settlement_date: 'desc' },
    });

    // Extract contract numbers from the raw extraction and group by contract
    const contractMap = new Map(); // contract_number → { buyer, settlements[] }
    for (const s of settlements) {
      const contractNum = s.extraction_json?.contract_number;
      if (!contractNum) continue;

      const key = String(contractNum).trim();
      if (!contractMap.has(key)) {
        contractMap.set(key, {
          contract_number: key,
          buyer: s.counterparty?.name || s.extraction_json?.buyer || s.buyer_format || 'Unknown',
          buyer_short_code: s.counterparty?.short_code || null,
          commodity: s.extraction_json?.commodity || null,
          settlements: [],
        });
      }
      contractMap.get(key).settlements.push({
        id: s.id,
        settlement_number: s.settlement_number,
        settlement_date: s.settlement_date,
        total_amount: s.total_amount,
        status: s.status,
        lines: s._count.lines,
      });
    }

    const missing = Array.from(contractMap.values()).sort((a, b) => a.buyer.localeCompare(b.buyer));

    // Also find settlements with NO contract number at all
    const noContract = settlements.filter(s => !s.extraction_json?.contract_number).map(s => ({
      id: s.id,
      settlement_number: s.settlement_number,
      settlement_date: s.settlement_date,
      total_amount: s.total_amount,
      status: s.status,
      buyer: s.counterparty?.name || s.buyer_format || 'Unknown',
      lines: s._count.lines,
    }));

    res.json({
      missing_contracts: missing,
      no_contract_number: noContract,
      total_unlinked: settlements.length,
    });
  } catch (err) { next(err); }
});

// GET recon gap report — JSON
router.get('/:farmId/settlements/reports/recon-gaps', authenticate, async (req, res, next) => {
  try {
    const opts = { fiscalYear: req.query.fiscal_year, month: req.query.month };
    const data = await generateReconGapData(req.params.farmId, opts);
    res.json(data);
  } catch (err) { next(err); }
});

// GET recon gap report — Excel download
router.get('/:farmId/settlements/reports/recon-gaps/excel', authenticate, async (req, res, next) => {
  try {
    const opts = { fiscalYear: req.query.fiscal_year, month: req.query.month };
    const wb = await generateReconGapExcel(req.params.farmId, opts);
    const filename = `recon-gap-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// GET recon gap report — PDF download
router.get('/:farmId/settlements/reports/recon-gaps/pdf', authenticate, async (req, res, next) => {
  try {
    const opts = { fiscalYear: req.query.fiscal_year, month: req.query.month };
    const docDefinition = await generateReconGapPdf(req.params.farmId, opts);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const filename = `recon-gap-report-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) { next(err); }
});

// GET recon gap report — CSV download
router.get('/:farmId/settlements/reports/recon-gaps/csv', authenticate, async (req, res, next) => {
  try {
    const opts = { fiscalYear: req.query.fiscal_year, month: req.query.month };
    const csv = await generateReconGapCsv(req.params.farmId, opts);
    const filename = `recon-gap-report-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// GET monthly three-way reconciliation report
router.get('/:farmId/settlements/reports/monthly-recon', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = req.query.fiscal_year || new Date().getFullYear();
    const opts = {};
    if (req.query.start_date) opts.startDate = req.query.start_date;
    if (req.query.end_date) opts.endDate = req.query.end_date;
    const data = await getMonthlyReconciliation(req.params.farmId, fiscalYear, opts);
    res.json(data);
  } catch (err) { next(err); }
});

// GET settlement by farm unit report — JSON
router.get('/:farmId/settlements/reports/by-farm-unit', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = req.query.fiscal_year || new Date().getFullYear();
    const opts = {};
    if (req.query.start_date) opts.startDate = req.query.start_date;
    if (req.query.end_date) opts.endDate = req.query.end_date;
    const data = await getSettlementsByFarmUnit(req.params.farmId, fiscalYear, opts);
    res.json(data);
  } catch (err) { next(err); }
});

// GET settlement by farm unit report — Excel download
router.get('/:farmId/settlements/reports/by-farm-unit/excel', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = req.query.fiscal_year || new Date().getFullYear();
    const opts = {};
    if (req.query.start_date) opts.startDate = req.query.start_date;
    if (req.query.end_date) opts.endDate = req.query.end_date;
    const wb = await generateFarmUnitExcel(req.params.farmId, fiscalYear, opts);
    const filename = `settlement-by-farm-unit-FY${fiscalYear}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// GET enterprise journal report — JSON
router.get('/:farmId/settlements/reports/enterprise-journal', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = req.query.fiscal_year || new Date().getFullYear();
    const data = await getEnterpriseJournal(req.params.farmId, fiscalYear);
    res.json(data);
  } catch (err) { next(err); }
});

// GET enterprise journal report — CSV (QBO-importable)
router.get('/:farmId/settlements/reports/enterprise-journal/csv', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = req.query.fiscal_year || new Date().getFullYear();
    const csv = await generateEnterpriseJournalCsv(req.params.farmId, fiscalYear);
    const filename = `enterprise-journal-FY${fiscalYear}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// GET enterprise journal report — Excel
router.get('/:farmId/settlements/reports/enterprise-journal/excel', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = req.query.fiscal_year || new Date().getFullYear();
    const wb = await generateEnterpriseJournalExcel(req.params.farmId, fiscalYear);
    const filename = `enterprise-journal-FY${fiscalYear}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// GET enterprise journal report — PDF
router.get('/:farmId/settlements/reports/enterprise-journal/pdf', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = req.query.fiscal_year || new Date().getFullYear();
    const docDefinition = await generateEnterpriseJournalPdf(req.params.farmId, fiscalYear);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const filename = `enterprise-journal-FY${fiscalYear}-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfDoc.pipe(res);
    pdfDoc.end();
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
        buyer_format || null,
        req.params.farmId
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

// ─── Extract-only (preview before save) ──────────────────────────────

// POST extract — returns AI extraction without saving (for review/edit flow)
router.post('/:farmId/settlements/extract', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.originalname.match(/\.(pdf|jpg|jpeg|png)$/i)) {
      return res.status(400).json({ error: 'Only PDF and image files are supported' });
    }

    const { buyer_format } = req.body;

    let extraction, buyerFormat, usage;
    try {
      ({ extraction, buyerFormat, usage } = await extractSettlementFromPdf(
        req.file.buffer,
        buyer_format || null,
        req.params.farmId
      ));
    } catch (apiErr) {
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

    // Return extraction for review — NOT saved yet
    res.json({ extraction, buyer_format: buyerFormat, usage });
  } catch (err) { next(err); }
});

// POST save — save reviewed/corrected extraction data
router.post('/:farmId/settlements/save-reviewed', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { extraction, buyer_format, usage, hint } = req.body;
    if (!extraction) return res.status(400).json({ error: 'No extraction data provided' });

    // Save settlement with (possibly corrected) extraction
    const settlement = await saveSettlement(
      req.params.farmId,
      extraction,
      buyer_format || 'unknown',
      { usage }
    );

    // If admin provided a correction hint, save it for future extractions
    if (hint && hint.trim()) {
      await prisma.settlementFormatHint.create({
        data: {
          farm_id: req.params.farmId,
          buyer_format: buyer_format || 'unknown',
          hint_text: hint.trim(),
          created_by: req.userId,
        },
      });
    }

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'Settlement',
      entityId: settlement.id,
      action: 'create',
      changes: {
        settlement_number: settlement.settlement_number,
        buyer_format: buyer_format,
        lines_extracted: settlement.lines.length,
        reviewed: true,
        had_corrections: !!hint,
        ai_usage: usage,
      },
    });

    res.status(201).json({ settlement, extraction, buyer_format, usage });
  } catch (err) { next(err); }
});

// ─── Format Hints (admin training for AI extraction) ─────────────────

// GET format hints for a buyer
router.get('/:farmId/settlements/format-hints', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { buyer_format } = req.query;
    const where = { farm_id: req.params.farmId };
    if (buyer_format) where.buyer_format = buyer_format;

    const hints = await prisma.settlementFormatHint.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
    res.json({ hints });
  } catch (err) { next(err); }
});

// POST add a format hint
router.post('/:farmId/settlements/format-hints', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { buyer_format, hint_text } = req.body;
    if (!buyer_format || !hint_text?.trim()) {
      return res.status(400).json({ error: 'buyer_format and hint_text are required' });
    }
    const hint = await prisma.settlementFormatHint.create({
      data: {
        farm_id: req.params.farmId,
        buyer_format,
        hint_text: hint_text.trim(),
        created_by: req.userId,
      },
    });
    res.status(201).json({ hint });
  } catch (err) { next(err); }
});

// DELETE a format hint
router.delete('/:farmId/settlements/format-hints/:hintId', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    await prisma.settlementFormatHint.delete({ where: { id: req.params.hintId } });
    res.json({ success: true });
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

// POST reconcile ALL pending settlements in batch
router.post('/:farmId/settlements/reconcile-all', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const pending = await prisma.settlement.findMany({
      where: { farm_id: farmId, status: 'pending' },
      select: { id: true, settlement_number: true },
      orderBy: { created_at: 'asc' },
    });

    if (pending.length === 0) {
      return res.json({ message: 'No pending settlements to reconcile', results: [], total: 0 });
    }

    const results = [];
    for (const s of pending) {
      try {
        const result = await reconcileSettlement(s.id);
        results.push({ id: s.id, settlement_number: s.settlement_number, status: 'reconciled', summary: result.summary });
        logAudit({
          farmId,
          userId: req.userId,
          entityType: 'Settlement',
          entityId: s.id,
          action: 'reconcile',
          changes: result.summary,
        });
      } catch (err) {
        results.push({ id: s.id, settlement_number: s.settlement_number, status: 'error', error: err.message });
      }
    }

    const succeeded = results.filter(r => r.status === 'reconciled').length;
    const failed = results.filter(r => r.status === 'error').length;
    res.json({ message: `Reconciled ${succeeded} of ${pending.length} settlements`, total: pending.length, succeeded, failed, results });
  } catch (err) { next(err); }
});

// POST run AI reconciliation on a settlement
// Body: { match_mode?: 'auto' | 'weight_date' }
// weight_date mode: skips ticket-number matching, scores on weight+date only.
// Used for three-party deliveries (buyer ≠ delivery site).
router.post('/:farmId/settlements/:id/reconcile', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const matchMode = req.body?.match_mode || 'auto';
    console.log(`[ROUTE] POST reconcile: settlement=${req.params.id} farm=${req.params.farmId} user=${req.userId} mode=${matchMode}`);
    const settlement = await prisma.settlement.findFirst({
      where: { id: req.params.id, farm_id: req.params.farmId },
    });
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });

    const result = await reconcileSettlement(req.params.id, { matchMode });

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'Settlement',
      entityId: req.params.id,
      action: 'reconcile',
      changes: { ...result.summary, match_mode: matchMode },
    });

    res.json(result);
  } catch (err) {
    console.error(`[ROUTE] Reconcile error:`, err.message);
    next(err);
  }
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

    const result = await approveSettlement(req.params.id, req.userId);

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'Settlement',
      entityId: req.params.id,
      action: 'approve',
      changes: result.report,
    });

    // Broadcast socket events
    const io = req.app.get('io');
    if (io) {
      broadcastMarketingEvent(io, req.params.farmId, 'settlement:approved', {
        settlement_id: req.params.id,
        report: result.report,
      });
      for (const contract of result.contracts_updated) {
        broadcastMarketingEvent(io, req.params.farmId, 'marketing:delivery:created', {
          contract_id: contract.contract_id,
          contract_number: contract.contract_number,
          delivered_mt: contract.delivered_mt,
          status: contract.new_status,
        });
      }
    }

    res.json({ settlement: result.settlement, report: result.report });
  } catch (err) { next(err); }
});

// POST dismiss a settlement line exception
router.post('/:farmId/settlements/:id/lines/:lineId/dismiss', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { notes } = req.body;
    const line = await prisma.settlementLine.findFirst({
      where: { id: req.params.lineId },
      include: { settlement: true },
    });
    if (!line || line.settlement.farm_id !== req.params.farmId || line.settlement.id !== req.params.id) {
      return res.status(404).json({ error: 'Settlement line not found' });
    }

    const updated = await prisma.settlementLine.update({
      where: { id: req.params.lineId },
      data: {
        match_status: 'manual',
        match_confidence: 0,
        exception_reason: `Dismissed: ${notes || 'No reason provided'}`,
        delivery_ticket_id: null,
      },
    });

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'SettlementLine',
      entityId: req.params.lineId,
      action: 'dismiss',
      changes: { notes },
    });

    res.json({ line: updated });
  } catch (err) { next(err); }
});

// GET settlement reconciliation report
router.get('/:farmId/settlements/:id/report', authenticate, async (req, res, next) => {
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
    if (settlement.status !== 'approved' || !settlement.reconciliation_report) {
      return res.status(404).json({ error: 'No reconciliation report available — settlement not yet approved' });
    }
    res.json({ settlement, report: settlement.reconciliation_report });
  } catch (err) { next(err); }
});

// GET export reconciliation report as Excel (type=full for all lines, default=exceptions only)
router.get('/:farmId/settlements/:id/export/excel', authenticate, async (req, res, next) => {
  try {
    console.log(`[EXPORT] Excel export requested for settlement ${req.params.id} farm ${req.params.farmId}`);
    const workbook = await generateExceptionExcel(req.params.id, req.params.farmId);
    const settlement = await prisma.settlement.findFirst({
      where: { id: req.params.id, farm_id: req.params.farmId },
      select: { settlement_number: true },
    });
    const filename = `reconciliation-report-${settlement?.settlement_number || req.params.id}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
    console.log(`[EXPORT] Excel sent: ${filename}`);
  } catch (err) {
    console.error(`[EXPORT] Excel error:`, err.message, err.stack);
    next(err);
  }
});

// GET export reconciliation report as PDF
router.get('/:farmId/settlements/:id/export/pdf', authenticate, async (req, res, next) => {
  try {
    console.log(`[EXPORT] PDF export requested for settlement ${req.params.id} farm ${req.params.farmId}`);
    const settlement = await prisma.settlement.findFirst({
      where: { id: req.params.id, farm_id: req.params.farmId },
      include: {
        counterparty: true,
        marketing_contract: { include: { commodity: true } },
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

    const docDefinition = generateExceptionPdf(settlement);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const filename = `reconciliation-report-${settlement.settlement_number}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfDoc.pipe(res);
    pdfDoc.end();
    console.log(`[EXPORT] PDF sent: ${filename}`);
  } catch (err) {
    console.error(`[EXPORT] PDF error:`, err.message, err.stack);
    next(err);
  }
});

// PATCH update settlement fields (status, notes, contract linkage, counterparty)
router.patch('/:farmId/settlements/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { status, notes, contract_number, counterparty_id, total_amount } = req.body;
    const settlement = await prisma.settlement.findFirst({
      where: { id: req.params.id, farm_id: req.params.farmId },
    });
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });

    const data = {};
    if (status) data.status = status;
    if (notes !== undefined) data.notes = notes;
    if (total_amount !== undefined) data.total_amount = total_amount;
    if (counterparty_id !== undefined) data.counterparty_id = counterparty_id || null;

    // Contract number lookup — find MarketingContract and link it (also sets commodity)
    if (contract_number !== undefined) {
      if (contract_number) {
        const mc = await prisma.marketingContract.findFirst({
          where: { farm_id: req.params.farmId, contract_number },
        });
        if (mc) {
          data.marketing_contract_id = mc.id;
        } else {
          return res.status(400).json({ error: `Contract #${contract_number} not found` });
        }
      } else {
        data.marketing_contract_id = null;
      }
    }

    const updated = await prisma.settlement.update({
      where: { id: req.params.id },
      data,
      include: {
        counterparty: { select: { name: true, short_code: true } },
        marketing_contract: { select: { contract_number: true, commodity: { select: { name: true } } } },
        _count: { select: { lines: true } },
      },
    });

    res.json({ settlement: updated });
  } catch (err) { next(err); }
});

// POST bulk approve settlements (admin cutoff tool)
router.post('/:farmId/settlements/bulk-approve', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { ids, notes } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const results = { approved: 0, errors: [] };

    for (const id of ids) {
      try {
        // Dismiss all unresolved lines so approval doesn't block
        await prisma.settlementLine.updateMany({
          where: {
            settlement_id: id,
            match_status: { in: ['unmatched', 'exception', null] },
          },
          data: {
            match_status: 'manual',
            exception_reason: notes || 'Approved — prior year cutoff',
          },
        });

        await prisma.settlement.update({
          where: { id },
          data: {
            status: 'approved',
            notes: notes || 'Approved — prior year cutoff',
          },
        });
        results.approved++;
      } catch (err) {
        results.errors.push(`${id}: ${err.message}`);
      }
    }

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'Settlement',
      entityId: 'bulk_approve',
      action: 'bulk_approve',
      changes: { approved: results.approved, requested: ids.length, notes },
    });

    res.json(results);
  } catch (err) { next(err); }
});

// DELETE settlement and its lines
router.delete('/:farmId/settlements/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const settlement = await prisma.settlement.findFirst({
      where: { id: req.params.id, farm_id: req.params.farmId },
    });
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });

    // Delete lines first (cascade should handle this, but be explicit)
    await prisma.settlementLine.deleteMany({ where: { settlement_id: req.params.id } });
    await prisma.settlement.delete({ where: { id: req.params.id } });

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'Settlement',
      entityId: req.params.id,
      action: 'delete',
      changes: { settlement_number: settlement.settlement_number },
    });

    res.json({ success: true });
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
