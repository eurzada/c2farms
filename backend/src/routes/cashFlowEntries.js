import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getCashFlowProjection } from '../services/marketingService.js';

const router = Router();

// Get cash flow projection
router.get('/:farmId/marketing/cash-flow', authenticate, async (req, res, next) => {
  try {
    const months = parseInt(req.query.months) || 6;
    const data = await getCashFlowProjection(req.params.farmId, months);
    res.json(data);
  } catch (err) { next(err); }
});

// CRUD for individual entries
router.get('/:farmId/marketing/cash-flow/entries', authenticate, async (req, res, next) => {
  try {
    const entries = await prisma.cashFlowEntry.findMany({
      where: { farm_id: req.params.farmId },
      orderBy: [{ period_date: 'asc' }, { category: 'asc' }],
    });
    res.json({ entries });
  } catch (err) { next(err); }
});

router.post('/:farmId/marketing/cash-flow/entries', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { period_date, entry_type, category, description, amount, notes, is_actual } = req.body;
    if (!period_date || !entry_type || !category || amount === undefined) {
      return res.status(400).json({ error: 'period_date, entry_type, category, and amount are required' });
    }

    const entry = await prisma.cashFlowEntry.create({
      data: {
        farm_id: req.params.farmId,
        period_date: new Date(period_date),
        entry_type,
        category,
        description: description || null,
        amount: parseFloat(amount),
        notes: notes || null,
        is_actual: is_actual || false,
      },
    });
    res.status(201).json({ entry });
  } catch (err) { next(err); }
});

router.put('/:farmId/marketing/cash-flow/entries/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const existing = await prisma.cashFlowEntry.findFirst({ where: { id: req.params.id, farm_id: req.params.farmId } });
    if (!existing) return res.status(404).json({ error: 'Cash flow entry not found' });

    const updateData = { ...req.body };
    if (updateData.period_date) updateData.period_date = new Date(updateData.period_date);
    if (updateData.amount !== undefined) updateData.amount = parseFloat(updateData.amount);

    const entry = await prisma.cashFlowEntry.update({
      where: { id: req.params.id },
      data: updateData,
    });
    res.json({ entry });
  } catch (err) { next(err); }
});

router.delete('/:farmId/marketing/cash-flow/entries/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const existing = await prisma.cashFlowEntry.findFirst({ where: { id: req.params.id, farm_id: req.params.farmId } });
    if (!existing) return res.status(404).json({ error: 'Cash flow entry not found' });
    await prisma.cashFlowEntry.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
