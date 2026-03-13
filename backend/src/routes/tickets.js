import { Router } from 'express';
import multer from 'multer';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { previewTicketImport, commitTicketImport } from '../services/ticketImportService.js';
import { logAudit } from '../services/auditService.js';
import { resolveInventoryFarm } from '../services/resolveInventoryFarm.js';

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
    const [total, settled, unsettled, matched, byCounterparty] = await Promise.all([
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
    ]);

    const counterpartyIds = byCounterparty.map(g => g.counterparty_id).filter(Boolean);
    const counterparties = counterpartyIds.length > 0
      ? await prisma.counterparty.findMany({
            where: { id: { in: counterpartyIds } },
            select: { id: true, name: true },
          })
      : [];
    const cpMap = Object.fromEntries(counterparties.map(cp => [cp.id, cp.name]));

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
      })),
    });
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

export default router;
