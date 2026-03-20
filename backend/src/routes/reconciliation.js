import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireRole } from '../middleware/auth.js';
import { computeReconciliation } from '../services/inventoryService.js';
import { resolveInventoryFarm } from '../services/resolveInventoryFarm.js';
import { previewElevatorTicketImport, commitElevatorTicketImport } from '../services/elevatorTicketImportService.js';
import prisma from '../config/database.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Resolve enterprise farm for all reconciliation routes
router.use('/:farmId/reconciliation', async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    req.params.farmId = farmId;
    next();
  } catch (err) { next(err); }
});

// GET reconciliation between two periods
router.get('/:farmId/reconciliation/:fromPeriodId/:toPeriodId', authenticate, async (req, res, next) => {
  try {
    const { farmId, fromPeriodId, toPeriodId } = req.params;
    const result = await computeReconciliation(farmId, fromPeriodId, toPeriodId);
    res.json(result);
  } catch (err) { next(err); }
});

// POST preview elevator ticket import
router.post('/:farmId/reconciliation/:periodId/elevator-tickets/preview', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    const { farmId, periodId } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileType = req.file.originalname.endsWith('.xlsx') ? 'xlsx' : 'csv';
    const result = await previewElevatorTicketImport(farmId, periodId, req.file.buffer, fileType);
    res.json(result);
  } catch (err) { next(err); }
});

// POST commit elevator ticket import
router.post('/:farmId/reconciliation/:periodId/elevator-tickets/commit', authenticate, async (req, res, next) => {
  try {
    const { farmId, periodId } = req.params;
    const { tickets, resolutions, source_file } = req.body;
    if (!tickets || !Array.isArray(tickets)) return res.status(400).json({ error: 'tickets array required' });
    const result = await commitElevatorTicketImport(farmId, periodId, tickets, resolutions, source_file);
    res.json(result);
  } catch (err) { next(err); }
});

// GET elevator tickets for a period
router.get('/:farmId/reconciliation/:periodId/elevator-tickets', authenticate, async (req, res, next) => {
  try {
    const { farmId, periodId } = req.params;
    const tickets = await prisma.elevatorTicket.findMany({
      where: { farm_id: farmId, count_period_id: periodId },
      include: { commodity: { select: { name: true, code: true } }, counterparty: { select: { name: true } } },
      orderBy: { delivery_date: 'asc' },
    });
    res.json({ tickets, count: tickets.length });
  } catch (err) { next(err); }
});

// DELETE all elevator tickets for a period (admin only)
router.delete('/:farmId/reconciliation/:periodId/elevator-tickets', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { farmId, periodId } = req.params;
    const deleted = await prisma.elevatorTicket.deleteMany({
      where: { farm_id: farmId, count_period_id: periodId },
    });
    res.json({ deleted: deleted.count });
  } catch (err) { next(err); }
});

export default router;
