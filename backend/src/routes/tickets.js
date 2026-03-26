import { Router } from 'express';
import multer from 'multer';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { previewTicketImport, commitTicketImport } from '../services/ticketImportService.js';
import { logAudit } from '../services/auditService.js';
import { resolveInventoryFarm } from '../services/resolveInventoryFarm.js';
import { backfillTicketContractLinks } from '../services/marketingService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Logistics is enterprise-wide — resolve BU farm → enterprise farm
router.use('/:farmId/tickets', async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    req.params.farmId = farmId;
    next();
  } catch (err) { next(err); }
});

// Build fiscal year date range filter (Nov-Oct fiscal year)
function fiscalYearDateFilter(fy) {
  const year = parseInt(fy);
  if (!year) return {};
  // FY2026 = Nov 1 2025 to Oct 31 2026
  return {
    delivery_date: {
      gte: new Date(`${year - 1}-11-01T00:00:00Z`),
      lt: new Date(`${year}-11-01T00:00:00Z`),
    },
  };
}

// GET all delivery tickets for a farm
router.get('/:farmId/tickets', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { contract_id, counterparty_id, commodity_id, settled, matched, fiscal_year, limit = '200', offset = '0' } = req.query;

    const where = { farm_id: farmId };
    if (contract_id) where.marketing_contract_id = contract_id;
    if (counterparty_id) where.counterparty_id = counterparty_id;
    if (commodity_id) where.commodity_id = commodity_id;
    if (settled !== undefined) where.settled = settled === 'true';
    if (matched === 'true') where.settlement_lines = { some: {} };
    if (matched === 'false') where.settlement_lines = { none: {} };
    if (fiscal_year) Object.assign(where, fiscalYearDateFilter(fiscal_year));

    const [tickets, total] = await Promise.all([
      prisma.deliveryTicket.findMany({
        where,
        include: {
          marketing_contract: { select: { contract_number: true } },
          counterparty: { select: { name: true, short_code: true } },
          commodity: { select: { name: true, code: true } },
          location: { select: { name: true, code: true } },
          bin: { select: { bin_number: true } },
          settlement_lines: {
            select: {
              id: true,
              match_status: true,
              settlement: { select: { id: true, settlement_number: true, status: true } },
            },
            take: 1,
          },
        },
        orderBy: { delivery_date: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.deliveryTicket.count({ where }),
    ]);

    res.json({ tickets, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) { next(err); }
});

// GET ticket stats for a farm (must be before /:id route)
router.get('/:farmId/tickets/stats/summary', authenticate, async (req, res, next) => {
  try {
    const farmId = req.params.farmId;
    const { fiscal_year } = req.query;
    const baseWhere = { farm_id: farmId, ...(fiscal_year ? fiscalYearDateFilter(fiscal_year) : {}) };
    const [total, settled, unsettled, matched, byCounterparty, byCounterpartyCommodity] = await Promise.all([
      prisma.deliveryTicket.count({ where: baseWhere }),
      prisma.deliveryTicket.count({ where: { ...baseWhere, settled: true } }),
      prisma.deliveryTicket.count({ where: { ...baseWhere, settled: false } }),
      prisma.deliveryTicket.count({ where: { ...baseWhere, settlement_lines: { some: {} } } }),
      prisma.deliveryTicket.groupBy({
        by: ['counterparty_id'],
        where: baseWhere,
        _count: true,
        _sum: { net_weight_mt: true },
      }),
      prisma.deliveryTicket.groupBy({
        by: ['counterparty_id', 'commodity_id'],
        where: baseWhere,
        _count: true,
        _sum: { net_weight_mt: true },
      }),
    ]);

    const counterpartyIds = byCounterparty.map(g => g.counterparty_id).filter(Boolean);
    const commodityIds = [...new Set(byCounterpartyCommodity.map(g => g.commodity_id).filter(Boolean))];
    const [counterparties, commodities] = await Promise.all([
      counterpartyIds.length > 0
        ? prisma.counterparty.findMany({
              where: { id: { in: counterpartyIds } },
              select: { id: true, name: true },
            })
        : [],
      commodityIds.length > 0
        ? prisma.commodity.findMany({
              where: { id: { in: commodityIds } },
              select: { id: true, name: true },
            })
        : [],
    ]);
    const cpMap = Object.fromEntries(counterparties.map(cp => [cp.id, cp.name]));
    const commMap = Object.fromEntries(commodities.map(c => [c.id, c.name]));

    // Build per-commodity breakdown keyed by counterparty_id
    const cpCommodityMap = {};
    for (const g of byCounterpartyCommodity) {
      const cpId = g.counterparty_id;
      if (!cpCommodityMap[cpId]) cpCommodityMap[cpId] = [];
      cpCommodityMap[cpId].push({
        commodity_id: g.commodity_id,
        commodity_name: commMap[g.commodity_id] || 'Unknown',
        count: g._count,
        total_mt: g._sum.net_weight_mt || 0,
      });
    }

    res.json({
      total,
      settled,
      unsettled,
      matched,
      by_counterparty: byCounterparty.map(g => ({
        counterparty_id: g.counterparty_id,
        counterparty_name: cpMap[g.counterparty_id] || 'Unknown',
        count: g._count,
        total_mt: g._sum.net_weight_mt || 0,
        by_commodity: (cpCommodityMap[g.counterparty_id] || []).sort((a, b) => b.total_mt - a.total_mt),
      })),
    });
  } catch (err) { next(err); }
});

// GET export as Excel
router.get('/:farmId/tickets/export/excel', authenticate, async (req, res, next) => {
  try {
    const { generateTicketExcel } = await import('../services/ticketExportService.js');
    const workbook = await generateTicketExcel(req.params.farmId, req.query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="tickets-${new Date().toISOString().slice(0,10)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// GET export as PDF
router.get('/:farmId/tickets/export/pdf', authenticate, async (req, res, next) => {
  try {
    const { generateTicketPdf } = await import('../services/ticketExportService.js');
    const { getFontPaths } = await import('../utils/fontPaths.js');
    const PdfPrinter = (await import('pdfmake')).default;
    const printer = new PdfPrinter({ Roboto: getFontPaths() });
    const docDef = await generateTicketPdf(req.params.farmId, req.query);
    const doc = printer.createPdfKitDocument(docDef);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="tickets-${new Date().toISOString().slice(0,10)}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) { next(err); }
});

// GET export as CSV
router.get('/:farmId/tickets/export/csv', authenticate, async (req, res, next) => {
  try {
    const { generateTicketCsv } = await import('../services/ticketExportService.js');
    const csv = await generateTicketCsv(req.params.farmId, req.query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="tickets-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// GET single ticket
router.get('/:farmId/tickets/:id', authenticate, async (req, res, next) => {
  try {
    const ticket = await prisma.deliveryTicket.findFirst({
      where: { id: req.params.id, farm_id: req.params.farmId },
      include: {
        marketing_contract: { include: { counterparty: true, commodity: true } },
        counterparty: true,
        commodity: true,
        location: true,
        bin: { include: { location: true } },
        settlement_lines: { include: { settlement: true } },
      },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ticket });
  } catch (err) { next(err); }
});

// POST preview CSV import (dry run)
router.post('/:farmId/tickets/import/preview', authenticate, requireRole('admin', 'manager'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.originalname.match(/\.csv$/i)) {
      return res.status(400).json({ error: 'Only CSV files are supported' });
    }
    const csvText = req.file.buffer.toString('utf-8');
    const result = await previewTicketImport(req.params.farmId, csvText);
    res.json(result);
  } catch (err) { next(err); }
});

// POST commit CSV import
router.post('/:farmId/tickets/import/commit', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { tickets, resolutions } = req.body;
    if (!Array.isArray(tickets) || tickets.length === 0) {
      return res.status(400).json({ error: 'tickets array is required' });
    }
    const result = await commitTicketImport(req.params.farmId, tickets, resolutions);
    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'DeliveryTicket',
      entityId: 'bulk_import',
      action: 'import',
      changes: { created: result.created, updated: result.updated },
    });
    res.json(result);
  } catch (err) { next(err); }
});

// PATCH bulk mark tickets as settled (admin cutoff tool)
router.patch('/:farmId/tickets/bulk-settle', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { ids, notes } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const result = await prisma.deliveryTicket.updateMany({
      where: { id: { in: ids }, farm_id: req.params.farmId },
      data: { settled: true, notes: notes || 'Marked settled — prior year cutoff' },
    });

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'DeliveryTicket',
      entityId: 'bulk_settle',
      action: 'bulk_settle',
      changes: { settled: result.count, requested: ids.length, notes },
    });

    res.json({ settled: result.count });
  } catch (err) { next(err); }
});

// PATCH single ticket (admin/manager edit)
router.patch('/:farmId/tickets/:ticketId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId, ticketId } = req.params;
    const ticket = await prisma.deliveryTicket.findFirst({
      where: { id: ticketId, farm_id: farmId },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.settled) {
      return res.status(400).json({ error: 'Cannot edit a settled ticket — un-settle it first' });
    }

    const allowedFields = [
      'ticket_number', 'grade', 'delivery_date', 'net_weight_kg',
      'destination', 'buyer_name', 'contract_number', 'notes',
    ];
    const data = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'delivery_date' && req.body[field]) {
          data[field] = new Date(req.body[field]);
        } else if (field === 'net_weight_kg' && req.body[field] != null) {
          data[field] = parseFloat(req.body[field]);
          data.net_weight_mt = data[field] / 1000;
        } else {
          data[field] = req.body[field];
        }
      }
    }

    // Handle commodity change by id
    if (req.body.commodity_id) {
      const commodity = await prisma.commodity.findFirst({
        where: { id: req.body.commodity_id, farm_id: farmId },
      });
      if (!commodity) return res.status(400).json({ error: 'Commodity not found' });
      data.commodity_id = commodity.id;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No editable fields provided' });
    }

    const updated = await prisma.deliveryTicket.update({
      where: { id: ticketId },
      data,
      include: {
        marketing_contract: { select: { contract_number: true } },
        counterparty: { select: { name: true, short_code: true } },
        commodity: { select: { name: true, code: true } },
        location: { select: { name: true, code: true } },
      },
    });

    logAudit({
      farmId,
      userId: req.userId,
      entityType: 'DeliveryTicket',
      entityId: ticketId,
      action: 'update',
      changes: data,
    });

    res.json({ ticket: updated });
  } catch (err) { next(err); }
});

// DELETE bulk delete tickets
router.delete('/:farmId/tickets', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    // Only delete tickets belonging to this farm
    const result = await prisma.deliveryTicket.deleteMany({
      where: { id: { in: ids }, farm_id: req.params.farmId },
    });

    logAudit({
      farmId: req.params.farmId,
      userId: req.userId,
      entityType: 'DeliveryTicket',
      entityId: 'bulk_delete',
      action: 'delete',
      changes: { deleted: result.count, requested: ids.length },
    });

    res.json({ deleted: result.count });
  } catch (err) { next(err); }
});

// POST backfill — link unlinked tickets to marketing contracts by contract_number
router.post('/:farmId/tickets/backfill-contracts', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const farmId = req.params.farmId;
    const result = await backfillTicketContractLinks(farmId);

    logAudit({
      farmId,
      userId: req.userId,
      entityType: 'DeliveryTicket',
      entityId: 'backfill_contracts',
      action: 'backfill',
      changes: result,
    });

    res.json(result);
  } catch (err) { next(err); }
});

export default router;
