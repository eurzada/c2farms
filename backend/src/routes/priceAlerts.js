import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/:farmId/marketing/price-alerts', authenticate, async (req, res, next) => {
  try {
    const alerts = await prisma.priceAlert.findMany({
      where: { farm_id: req.params.farmId },
      include: { commodity: { select: { name: true, code: true } } },
      orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }],
    });
    res.json({ alerts });
  } catch (err) { next(err); }
});

router.post('/:farmId/marketing/price-alerts', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { commodity_id, alert_type, direction, threshold_value, notify_method, notes } = req.body;
    if (!commodity_id || !alert_type || !direction || threshold_value === undefined) {
      return res.status(400).json({ error: 'commodity_id, alert_type, direction, and threshold_value are required' });
    }

    const alert = await prisma.priceAlert.create({
      data: {
        farm_id: req.params.farmId,
        commodity_id,
        alert_type,
        direction,
        threshold_value: parseFloat(threshold_value),
        notify_method: notify_method || 'in_app',
        created_by: req.userId,
        notes: notes || null,
      },
      include: { commodity: { select: { name: true, code: true } } },
    });
    res.status(201).json({ alert });
  } catch (err) { next(err); }
});

router.put('/:farmId/marketing/price-alerts/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const alert = await prisma.priceAlert.update({
      where: { id: req.params.id },
      data: req.body,
      include: { commodity: { select: { name: true, code: true } } },
    });
    res.json({ alert });
  } catch (err) { next(err); }
});

router.delete('/:farmId/marketing/price-alerts/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    await prisma.priceAlert.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
