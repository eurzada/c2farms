import { Router } from 'express';
import multer from 'multer';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import { extractContractFromPdf } from '../services/contractExtractionService.js';
import * as binService from '../services/terminalBinService.js';
import * as ticketService from '../services/terminalTicketService.js';
import * as ticketImportService from '../services/terminalTicketImportService.js';
import * as blendService from '../services/terminalBlendService.js';
import * as sampleService from '../services/terminalSampleService.js';
import * as dashboardService from '../services/terminalDashboardService.js';
import * as contractService from '../services/terminalContractService.js';
import * as settlementService from '../services/terminalSettlementService.js';
import * as exportService from '../services/terminalExportService.js';
import PdfPrinter from 'pdfmake';
import { getFontPaths } from '../utils/fontPaths.js';

const pdfPrinter = new PdfPrinter({ Roboto: getFontPaths() });

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Bins ─────────────────────────────────────────────────────────────────────

router.get('/:farmId/terminal/bins', authenticate, async (req, res, next) => {
  try {
    const data = await binService.getBins(req.params.farmId);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/bins/:binId/ledger', authenticate, async (req, res, next) => {
  try {
    const { page = '1', limit = '50' } = req.query;
    const data = await binService.getBinLedger(req.params.farmId, req.params.binId, {
      page: parseInt(page),
      limit: parseInt(limit),
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.put('/:farmId/terminal/bins/:binId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await binService.updateBin(req.params.farmId, req.params.binId, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/bins/:binId/sweep', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await binService.sweepBin(req.params.farmId, req.params.binId, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/bins/:binId/recalculate', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await binService.recalculateBin(req.params.farmId, req.params.binId);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/bins/:binId/allocate-tickets', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { ticket_ids } = req.body;
    if (!Array.isArray(ticket_ids) || ticket_ids.length === 0) {
      return res.status(400).json({ error: 'ticket_ids is required and must be a non-empty array' });
    }
    const result = await ticketService.allocateTicketsToBin(req.params.farmId, req.params.binId, ticket_ids);
    res.json(result);
  } catch (err) { next(err); }
});

// ── Tickets ──────────────────────────────────────────────────────────────────

// ── Ticket Import (CSV) ─────────────────────────────────────────────────────
// Must come before :ticketId to avoid route conflicts

router.post('/:farmId/terminal/tickets/import/preview', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const csvText = req.file.buffer.toString('utf-8');
    const result = await ticketImportService.previewTerminalImport(req.params.farmId, csvText);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/tickets/import/commit', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { tickets } = req.body;
    if (!Array.isArray(tickets) || tickets.length === 0) {
      return res.status(400).json({ error: 'tickets array is required' });
    }
    const result = await ticketImportService.commitTerminalImport(req.params.farmId, tickets);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/tickets/unallocated', authenticate, async (req, res, next) => {
  try {
    const tickets = await ticketService.getUnallocatedTickets(req.params.farmId);
    res.json({ tickets });
  } catch (err) { next(err); }
});

// Stats must come before :ticketId to avoid route conflicts
router.get('/:farmId/terminal/tickets/stats', authenticate, async (req, res, next) => {
  try {
    const data = await ticketService.getTicketStats(req.params.farmId);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/tickets', authenticate, async (req, res, next) => {
  try {
    const { direction, page = '1', limit = '50', startDate, endDate, growerName, product } = req.query;
    const data = await ticketService.getTickets(req.params.farmId, {
      direction,
      page: parseInt(page),
      limit: parseInt(limit),
      startDate,
      endDate,
      growerName,
      product,
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/tickets', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await ticketService.createTicket(req.params.farmId, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.put('/:farmId/terminal/tickets/:ticketId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await ticketService.updateTicket(req.params.farmId, req.params.ticketId, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/tickets/batch-assign-contract', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { ticket_ids, contract_id } = req.body;
    if (!Array.isArray(ticket_ids) || ticket_ids.length === 0) {
      return res.status(400).json({ error: 'ticket_ids is required and must be a non-empty array' });
    }
    if (!contract_id) {
      return res.status(400).json({ error: 'contract_id is required' });
    }
    // Verify contract belongs to this farm
    const contract = await prisma.terminalContract.findFirst({
      where: { id: contract_id, farm_id: req.params.farmId },
    });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    // Update all specified tickets
    const result = await prisma.terminalTicket.updateMany({
      where: {
        id: { in: ticket_ids },
        farm_id: req.params.farmId,
        direction: 'inbound',
      },
      data: { contract_id },
    });
    res.json({ updated: result.count });
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/tickets/:ticketId/void', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await ticketService.voidTicket(req.params.farmId, req.params.ticketId);
    res.json(data);
  } catch (err) { next(err); }
});

// ── Blend Events ─────────────────────────────────────────────────────────────

router.get('/:farmId/terminal/blends', authenticate, async (req, res, next) => {
  try {
    const data = await blendService.getBlendEvents(req.params.farmId);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/blends', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await blendService.createBlendEvent(req.params.farmId, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.delete('/:farmId/terminal/blends/:eventId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await blendService.deleteBlendEvent(req.params.farmId, req.params.eventId);
    res.json(data);
  } catch (err) { next(err); }
});

// ── Samples ──────────────────────────────────────────────────────────────────

router.get('/:farmId/terminal/samples', authenticate, async (req, res, next) => {
  try {
    const data = await sampleService.getSamples(req.params.farmId);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/tickets/:ticketId/samples', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await sampleService.createSample(req.params.farmId, req.params.ticketId, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.put('/:farmId/terminal/samples/:sampleId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await sampleService.updateSample(req.params.farmId, req.params.sampleId, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.delete('/:farmId/terminal/samples/:sampleId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await sampleService.deleteSample(req.params.farmId, req.params.sampleId);
    res.json(data);
  } catch (err) { next(err); }
});

// ── Lookups (counterparties + commodities for terminal use) ──────────────────

router.get('/:farmId/terminal/counterparties', authenticate, async (req, res, next) => {
  try {
    const counterparties = await prisma.counterparty.findMany({
      where: { farm_id: req.params.farmId, is_active: true },
      orderBy: { name: 'asc' },
    });
    res.json({ counterparties });
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/counterparties', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const cp = await prisma.counterparty.create({
      data: {
        farm_id: req.params.farmId,
        name: req.body.name,
        short_code: req.body.short_code || req.body.name.substring(0, 4).toUpperCase(),
        type: req.body.type || 'buyer',
        contact_name: req.body.contact_name || null,
        contact_email: req.body.contact_email || null,
        contact_phone: req.body.contact_phone || null,
      },
    });
    res.status(201).json(cp);
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/commodities', authenticate, async (req, res, next) => {
  try {
    const commodities = await prisma.commodity.findMany({
      where: { farm_id: req.params.farmId },
      orderBy: { name: 'asc' },
    });
    res.json({ commodities });
  } catch (err) { next(err); }
});

// ── Contracts ────────────────────────────────────────────────────────────────

router.get('/:farmId/terminal/contracts/summary', authenticate, async (req, res, next) => {
  try {
    const data = await contractService.getContractSummary(req.params.farmId);
    res.json(data);
  } catch (err) { next(err); }
});

// Single-file import (must come before /:contractId)
router.post('/:farmId/terminal/contracts/import-pdf', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res, next) => {
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
    res.json({ extraction, usage });
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/contracts/import-pdf/check-duplicate', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { contract_number } = req.body;
    if (!contract_number) return res.json({ duplicate: false });
    const existing = await prisma.terminalContract.findFirst({
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

router.get('/:farmId/terminal/contracts', authenticate, async (req, res, next) => {
  try {
    const { direction, status, page = '1', limit = '50' } = req.query;
    const data = await contractService.getContracts(req.params.farmId, {
      direction, status, page: parseInt(page), limit: parseInt(limit),
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/contracts/:contractId', authenticate, async (req, res, next) => {
  try {
    const data = await contractService.getContract(req.params.farmId, req.params.contractId);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/contracts', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await contractService.createContract(req.params.farmId, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.put('/:farmId/terminal/contracts/:contractId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const data = await contractService.updateContract(req.params.farmId, req.params.contractId, req.body, io);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/contracts/:contractId/delivery', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await contractService.addDelivery(req.params.farmId, req.params.contractId, req.body.mt);
    res.json(data);
  } catch (err) { next(err); }
});

// ── Settlements ──────────────────────────────────────────────────────────────

router.get('/:farmId/terminal/settlements/summary', authenticate, async (req, res, next) => {
  try {
    const data = await settlementService.getSettlementSummary(req.params.farmId);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/settlements', authenticate, async (req, res, next) => {
  try {
    const { type, status, page = '1', limit = '50' } = req.query;
    const data = await settlementService.getSettlements(req.params.farmId, {
      type, status, page: parseInt(page), limit: parseInt(limit),
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/settlements/:settlementId', authenticate, async (req, res, next) => {
  try {
    const data = await settlementService.getSettlement(req.params.farmId, req.params.settlementId);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/settlements/:settlementId/eligible-tickets', authenticate, async (req, res, next) => {
  try {
    const settlement = await settlementService.getSettlement(req.params.farmId, req.params.settlementId);
    const tickets = await settlementService.getEligibleTickets(req.params.farmId, settlement.type);
    res.json({ tickets });
  } catch (err) { next(err); }
});

// Also expose eligible tickets without a settlement context
router.get('/:farmId/terminal/eligible-tickets', authenticate, async (req, res, next) => {
  try {
    const { type = 'transfer' } = req.query;
    const tickets = await settlementService.getEligibleTickets(req.params.farmId, type);
    res.json({ tickets });
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/settlements', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await settlementService.createSettlementWithLines(req.params.farmId, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.put('/:farmId/terminal/settlements/:settlementId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await settlementService.updateSettlement(req.params.farmId, req.params.settlementId, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/settlements/:settlementId/apply-pricing', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await settlementService.applyGradePricing(req.params.settlementId);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/settlements/:settlementId/finalize', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const data = await settlementService.finalizeSettlement(req.params.farmId, req.params.settlementId);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:farmId/terminal/settlements/:settlementId/push', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const data = await settlementService.pushToLogistics(req.params.farmId, req.params.settlementId, io);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/settlements/:settlementId/invoice', authenticate, async (req, res, next) => {
  try {
    const pdfBuffer = await settlementService.generateTransloadingInvoice(req.params.farmId, req.params.settlementId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=transloading-invoice-${req.params.settlementId}.pdf`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});

// ── Reports / Exports ────────────────────────────────────────────────────────

router.get('/:farmId/terminal/reports/grain-balance/excel', authenticate, async (req, res, next) => {
  try {
    const wb = await exportService.generateGrainBalanceReport(req.params.farmId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=grain-balance.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/reports/grain-balance/pdf', authenticate, async (req, res, next) => {
  try {
    const docDef = await exportService.generateGrainBalancePdf(req.params.farmId);
    const pdfDoc = pdfPrinter.createPdfKitDocument(docDef);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=grain-balance.pdf');
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/reports/shipping-history', authenticate, async (req, res, next) => {
  try {
    const { buyer, startDate, endDate } = req.query;
    const wb = await exportService.generateShippingHistory(req.params.farmId, { buyer, startDate, endDate });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=shipping-history.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/reports/quality-summary', authenticate, async (req, res, next) => {
  try {
    const wb = await exportService.generateQualitySummary(req.params.farmId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=quality-summary.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

router.get('/:farmId/terminal/reports/contract-fulfillment', authenticate, async (req, res, next) => {
  try {
    const { buyer } = req.query;
    const wb = await exportService.generateContractFulfillment(req.params.farmId, { buyer });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=contract-fulfillment.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// ── Dashboard ────────────────────────────────────────────────────────────────

router.get('/:farmId/terminal/dashboard', authenticate, async (req, res, next) => {
  try {
    const data = await dashboardService.getDashboard(req.params.farmId);
    res.json(data);
  } catch (err) { next(err); }
});

export default router;
