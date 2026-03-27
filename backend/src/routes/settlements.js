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
import { recalculateContract } from '../services/marketingService.js';
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

    // Enrich each settlement with total_mt and avg_mt_per_line from its lines
    const settlementIds = settlements.map(s => s.id);
    const lineAggs = settlementIds.length > 0 ? await prisma.settlementLine.groupBy({
      by: ['settlement_id'],
      where: { settlement_id: { in: settlementIds } },
      _sum: { net_weight_mt: true },
      _count: true,
    }) : [];
    const aggMap = Object.fromEntries(lineAggs.map(a => [a.settlement_id, {
      total_mt: a._sum.net_weight_mt || 0,
      line_count: a._count,
    }]));

    const enriched = settlements.map(s => {
      const agg = aggMap[s.id] || { total_mt: 0, line_count: 0 };
      return {
        ...s,
        total_mt: Math.round(agg.total_mt * 100) / 100,
        avg_mt_per_line: agg.line_count > 0 ? Math.round((agg.total_mt / agg.line_count) * 100) / 100 : 0,
      };
    });

    res.json({ settlements: enriched, total, total_mt: mtAgg._sum.net_weight_mt || 0 });
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

// POST re-link orphaned settlements to existing MarketingContracts by contract number
router.post('/:farmId/settlements/relink-contracts', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const farmId = req.params.farmId;
    // Find all settlements with no marketing_contract_id but with a contract number in extraction_json
    const orphans = await prisma.settlement.findMany({
      where: { farm_id: farmId, marketing_contract_id: null },
      select: { id: true, extraction_json: true },
    });

    let linked = 0;
    const affectedContractIds = new Set();
    for (const s of orphans) {
      const contractNum = s.extraction_json?.contract_number;
      if (!contractNum) continue;
      const mc = await prisma.marketingContract.findFirst({
        where: { farm_id: farmId, contract_number: String(contractNum).trim() },
        select: { id: true },
      });
      if (mc) {
        // Link settlement to contract
        await prisma.settlement.update({
          where: { id: s.id },
          data: { marketing_contract_id: mc.id },
        });

        // Cascade to matched tickets — apply contract + buyer from the contract
        const lines = await prisma.settlementLine.findMany({
          where: { settlement_id: s.id, delivery_ticket_id: { not: null } },
          select: { delivery_ticket_id: true },
        });
        const ticketIds = lines.map(l => l.delivery_ticket_id);
        if (ticketIds.length > 0) {
          const contract = await prisma.marketingContract.findUnique({
            where: { id: mc.id },
            select: { id: true, counterparty_id: true, commodity_id: true },
          });
          await prisma.deliveryTicket.updateMany({
            where: { id: { in: ticketIds } },
            data: {
              marketing_contract_id: mc.id,
              ...(contract.counterparty_id && { counterparty_id: contract.counterparty_id }),
              ...(contract.commodity_id && { commodity_id: contract.commodity_id }),
            },
          });
        }

        linked++;
        affectedContractIds.add(mc.id);
      }
    }

    // Recalculate all affected contracts so delivered_mt/remaining_mt/status update
    for (const contractId of affectedContractIds) {
      await recalculateContract(contractId);
    }

    res.json({ linked, contracts_recalculated: affectedContractIds.size, message: `Re-linked ${linked} settlement(s) to existing contracts` });
  } catch (err) { next(err); }
});

// POST suggest fuzzy contract matches for orphaned settlements
router.post('/:farmId/settlements/suggest-contract-matches', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const farmId = req.params.farmId;

    // Get orphaned settlements with extracted contract numbers
    const orphans = await prisma.settlement.findMany({
      where: { farm_id: farmId, marketing_contract_id: null },
      select: {
        id: true,
        settlement_number: true,
        settlement_date: true,
        total_amount: true,
        counterparty_id: true,
        extraction_json: true,
        counterparty: { select: { name: true } },
      },
    });

    const withContractNum = orphans.filter(s => s.extraction_json?.contract_number);
    if (withContractNum.length === 0) {
      return res.json({ suggestions: [], message: 'No orphaned settlements with contract numbers found' });
    }

    // Get all contracts for this farm
    const contracts = await prisma.marketingContract.findMany({
      where: { farm_id: farmId },
      select: {
        id: true,
        contract_number: true,
        counterparty_id: true,
        contracted_mt: true,
        status: true,
        counterparty: { select: { name: true } },
        commodity: { select: { name: true } },
      },
    });

    function normalize(s) {
      return String(s).replace(/[-\s_.]/g, '').toUpperCase().replace(/^0+/, '');
    }

    function levenshtein(a, b) {
      const m = a.length, n = b.length;
      if (m === 0) return n;
      if (n === 0) return m;
      const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
      return dp[m][n];
    }

    // Group orphans by extracted contract number
    const groups = {};
    for (const s of withContractNum) {
      const key = String(s.extraction_json.contract_number).trim();
      if (!groups[key]) groups[key] = { extracted_contract_number: key, settlements: [] };
      groups[key].settlements.push(s);
    }

    const suggestions = [];
    for (const group of Object.values(groups)) {
      const extracted = group.extracted_contract_number;
      const normExtracted = normalize(extracted);
      const settlementCounterpartyId = group.settlements[0]?.counterparty_id;

      // Check if exact match exists (already linked by relink) — skip
      const exactMatch = contracts.find(c => c.contract_number === extracted);
      if (exactMatch) continue; // relink would handle this

      const matches = [];
      for (const c of contracts) {
        const normContract = normalize(c.contract_number);
        let score = 0;
        let reason = '';

        if (normExtracted === normContract) {
          score = 0.95;
          reason = 'Exact match after normalization';
        } else if (normContract.includes(normExtracted) || normExtracted.includes(normContract)) {
          score = 0.75;
          reason = 'Substring match';
        } else {
          const dist = levenshtein(normExtracted, normContract);
          if (dist <= 2) {
            score = 0.6 - (dist * 0.1);
            reason = `Near match (edit distance ${dist})`;
          }
        }

        if (score > 0) {
          // Boost if same counterparty
          if (settlementCounterpartyId && c.counterparty_id === settlementCounterpartyId) {
            score = Math.min(1, score + 0.15);
            reason += ' + same buyer';
          }
          matches.push({
            contract_id: c.id,
            contract_number: c.contract_number,
            counterparty: c.counterparty?.name,
            commodity: c.commodity?.name,
            contracted_mt: c.contracted_mt,
            confidence: score >= 0.85 ? 'high' : score >= 0.6 ? 'medium' : 'low',
            score,
            reason,
          });
        }
      }

      matches.sort((a, b) => b.score - a.score);

      if (matches.length > 0) {
        suggestions.push({
          extracted_contract_number: extracted,
          buyer: group.settlements[0]?.counterparty?.name || '',
          settlement_ids: group.settlements.map(s => s.id),
          settlement_count: group.settlements.length,
          total_amount: group.settlements.reduce((sum, s) => sum + (s.total_amount || 0), 0),
          suggestions: matches.slice(0, 3),
        });
      }
    }

    suggestions.sort((a, b) => (b.suggestions[0]?.score || 0) - (a.suggestions[0]?.score || 0));

    res.json({
      suggestions,
      total_orphaned: withContractNum.length,
      total_with_suggestions: suggestions.reduce((n, g) => n + g.settlement_count, 0),
    });
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
    const contractFilter = req.query.contract || null;
    const periodFilter = req.query.period ? parseInt(req.query.period, 10) : null;
    const exportedFilter = req.query.exported || null;
    const data = await getEnterpriseJournal(req.params.farmId, fiscalYear, { contractFilter, periodFilter, exportedFilter });
    res.json(data);
  } catch (err) { next(err); }
});

// GET enterprise journal report — CSV (QBO-importable)
router.get('/:farmId/settlements/reports/enterprise-journal/csv', authenticate, async (req, res, next) => {
  try {
    const fiscalYear = req.query.fiscal_year || new Date().getFullYear();
    const contractFilter = req.query.contract || null;
    const periodFilter = req.query.period ? parseInt(req.query.period, 10) : null;
    const exportedFilter = req.query.exported || null;
    const csv = await generateEnterpriseJournalCsv(req.params.farmId, fiscalYear, { contractFilter, periodFilter, exportedFilter });
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
    const contractFilter = req.query.contract || null;
    const periodFilter = req.query.period ? parseInt(req.query.period, 10) : null;
    const exportedFilter = req.query.exported || null;
    const wb = await generateEnterpriseJournalExcel(req.params.farmId, fiscalYear, { contractFilter, periodFilter, exportedFilter });
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
    const contractFilter = req.query.contract || null;
    const periodFilter = req.query.period ? parseInt(req.query.period, 10) : null;
    const exportedFilter = req.query.exported || null;
    const docDefinition = await generateEnterpriseJournalPdf(req.params.farmId, fiscalYear, { contractFilter, periodFilter, exportedFilter });
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const filename = `enterprise-journal-FY${fiscalYear}-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) { next(err); }
});

// POST mark settlements as exported to QB
router.post('/:farmId/settlements/mark-exported', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const result = await prisma.settlement.updateMany({
      where: { id: { in: ids }, farm_id: req.params.farmId },
      data: { exported_at: new Date() },
    });
    res.json({ marked: result.count });
  } catch (err) { next(err); }
});

// POST unmark settlements as exported
router.post('/:farmId/settlements/unmark-exported', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const result = await prisma.settlement.updateMany({
      where: { id: { in: ids }, farm_id: req.params.farmId },
      data: { exported_at: null },
    });
    res.json({ unmarked: result.count });
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
    let extraction, buyerFormat, usage, validation;
    try {
      ({ extraction, buyerFormat, usage, validation } = await extractSettlementFromPdf(
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

    // Save to database (may split multi-contract PDFs into separate settlements)
    const settlement = await saveSettlement(
      req.params.farmId,
      extraction,
      buyerFormat,
      { usage }
    );

    const allSettlements = settlement._split_settlements || [settlement];
    for (const s of allSettlements) {
      logAudit({
        farmId: req.params.farmId,
        userId: req.userId,
        entityType: 'Settlement',
        entityId: s.id,
        action: 'create',
        changes: {
          settlement_number: s.settlement_number,
          buyer_format: buyerFormat,
          lines_extracted: s.lines.length,
          split: allSettlements.length > 1,
          ai_usage: usage,
        },
      });
    }

    res.status(201).json({
      settlement,
      settlements: allSettlements.length > 1 ? allSettlements : undefined,
      split: allSettlements.length > 1,
      extraction,
      buyer_format: buyerFormat,
      usage,
      validation,
    });
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

    let extraction, buyerFormat, usage, validation;
    try {
      ({ extraction, buyerFormat, usage, validation } = await extractSettlementFromPdf(
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
    res.json({ extraction, buyer_format: buyerFormat, usage, validation });
  } catch (err) { next(err); }
});

// POST save — save reviewed/corrected extraction data
router.post('/:farmId/settlements/save-reviewed', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { extraction, buyer_format, usage, hint } = req.body;
    if (!extraction) return res.status(400).json({ error: 'No extraction data provided' });

    // Save settlement with (possibly corrected) extraction — may split multi-contract
    const settlement = await saveSettlement(
      req.params.farmId,
      extraction,
      buyer_format || 'unknown',
      { usage }
    );

    const allSettlements = settlement._split_settlements || [settlement];

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

    for (const s of allSettlements) {
      logAudit({
        farmId: req.params.farmId,
        userId: req.userId,
        entityType: 'Settlement',
        entityId: s.id,
        action: 'create',
        changes: {
          settlement_number: s.settlement_number,
          buyer_format: buyer_format,
          lines_extracted: s.lines.length,
          reviewed: true,
          split: allSettlements.length > 1,
          had_corrections: !!hint,
          ai_usage: usage,
        },
      });
    }

    // Broadcast settlement creation for real-time table updates
    const io = req.app.get('io');
    if (io) {
      for (const s of allSettlements) {
        broadcastMarketingEvent(io, req.params.farmId, 'settlement:created', {
          id: s.id,
          settlement_number: s.settlement_number,
          buyer_format,
          split: allSettlements.length > 1,
        });
      }
    }

    res.status(201).json({
      settlement,
      settlements: allSettlements.length > 1 ? allSettlements : undefined,
      split: allSettlements.length > 1,
      extraction,
      buyer_format,
      usage,
    });
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

    // Capture old contract id before update for recalc
    const oldContractId = settlement.marketing_contract_id;

    const updated = await prisma.settlement.update({
      where: { id: req.params.id },
      data,
      include: {
        counterparty: { select: { name: true, short_code: true } },
        marketing_contract: { select: { contract_number: true, commodity: { select: { name: true } } } },
        _count: { select: { lines: true } },
      },
    });

    // When contract linkage changes, cascade to matched tickets and recalculate
    if (data.marketing_contract_id !== undefined) {
      // Cascade contract + buyer to matched tickets
      if (data.marketing_contract_id) {
        const lines = await prisma.settlementLine.findMany({
          where: { settlement_id: req.params.id, delivery_ticket_id: { not: null } },
          select: { delivery_ticket_id: true },
        });
        const ticketIds = lines.map(l => l.delivery_ticket_id);
        if (ticketIds.length > 0) {
          const contract = await prisma.marketingContract.findUnique({
            where: { id: data.marketing_contract_id },
            select: { id: true, counterparty_id: true, commodity_id: true },
          });
          await prisma.deliveryTicket.updateMany({
            where: { id: { in: ticketIds } },
            data: {
              marketing_contract_id: data.marketing_contract_id,
              ...(contract?.counterparty_id && { counterparty_id: contract.counterparty_id }),
              ...(contract?.commodity_id && { commodity_id: contract.commodity_id }),
            },
          });
        }
      }

      if (oldContractId) await recalculateContract(oldContractId);
      if (data.marketing_contract_id) await recalculateContract(data.marketing_contract_id);
    }

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

    const results = { approved: 0, skipped: 0, errors: [] };

    for (const id of ids) {
      try {
        // Only approve settlements that are reconciled
        const settlement = await prisma.settlement.findUnique({ where: { id }, select: { status: true } });
        if (!settlement || !['reconciled'].includes(settlement.status)) {
          results.skipped++;
          results.errors.push(`${id}: skipped — status is '${settlement?.status || 'not found'}', must be 'reconciled'`);
          continue;
        }

        // Dismiss all unresolved lines so approval doesn't block
        await prisma.settlementLine.updateMany({
          where: {
            settlement_id: id,
            match_status: { in: ['unmatched', 'exception'] },
          },
          data: {
            match_status: 'manual',
            exception_reason: notes || 'Approved — prior year cutoff',
          },
        });

        // Run full approval pipeline (Delivery records, MarketingContract updates, CashFlowEntry)
        await approveSettlement(id, req.userId);
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

// POST bulk unapprove settlements — reverses approval side effects
router.post('/:farmId/settlements/bulk-unapprove', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { ids, notes } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const results = { unapproved: 0, errors: [], details: [] };
    const contractIdsToReaggregate = new Set();

    for (const id of ids) {
      try {
        const settlement = await prisma.settlement.findFirst({
          where: { id, farm_id: req.params.farmId, status: 'approved' },
          include: {
            lines: { include: { delivery_ticket: { include: { marketing_contract: true } } } },
          },
        });
        if (!settlement) {
          results.errors.push(`${id}: not found or not approved`);
          continue;
        }

        await prisma.$transaction(async (tx) => {
          // 1. Un-settle matched tickets
          const ticketIds = settlement.lines
            .filter(l => l.delivery_ticket_id)
            .map(l => l.delivery_ticket_id);
          if (ticketIds.length > 0) {
            await tx.deliveryTicket.updateMany({
              where: { id: { in: ticketIds } },
              data: { settled: false },
            });
          }

          // 2. Delete auto-created Delivery records from this settlement's tickets
          for (const line of settlement.lines) {
            const ticket = line.delivery_ticket;
            if (!ticket?.marketing_contract_id) continue;
            await tx.delivery.deleteMany({
              where: {
                marketing_contract_id: ticket.marketing_contract_id,
                ticket_number: ticket.ticket_number,
                farm_id: req.params.farmId,
                notes: 'Auto-created from settlement approval',
              },
            });
            contractIdsToReaggregate.add(ticket.marketing_contract_id);
          }

          // 3. Delete auto-created CashFlowEntry records
          await tx.cashFlowEntry.deleteMany({
            where: {
              farm_id: req.params.farmId,
              is_actual: true,
              notes: 'Auto-created from settlement approval',
              description: { contains: settlement.settlement_number },
            },
          });

          // 4. Reset settlement status and clear report
          await tx.settlement.update({
            where: { id },
            data: {
              status: 'pending',
              reconciliation_report: null,
              notes: notes || 'Unapproved by admin for re-reconciliation',
            },
          });

          // 5. Reset line match statuses back to unmatched, clear ticket links
          await tx.settlementLine.updateMany({
            where: { settlement_id: id },
            data: {
              match_status: 'unmatched',
              delivery_ticket_id: null,
              match_confidence: null,
              exception_reason: null,
            },
          });
        });

        results.unapproved++;
        results.details.push({ id, settlement_number: settlement.settlement_number });
      } catch (err) {
        results.errors.push(`${id}: ${err.message}`);
      }
    }

    // Recalculate all affected contracts
    for (const contractId of contractIdsToReaggregate) {
      await recalculateContract(contractId);
    }

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'Settlement',
      entityId: 'bulk_unapprove',
      action: 'bulk_unapprove',
      changes: { unapproved: results.unapproved, requested: ids.length, notes },
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
