import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/:farmId/marketing/counterparties', authenticate, async (req, res, next) => {
  try {
    const counterparties = await prisma.counterparty.findMany({
      where: { farm_id: req.params.farmId },
      include: {
        marketing_contracts: {
          select: { id: true, contracted_mt: true, contract_value: true, status: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Enrich with aggregates
    const result = counterparties.map(cp => {
      const contracts = cp.marketing_contracts || [];
      return {
        ...cp,
        total_contracts: contracts.length,
        total_mt: contracts.reduce((s, c) => s + c.contracted_mt, 0),
        total_value: contracts.reduce((s, c) => s + (c.contract_value || 0), 0),
        active_contracts: contracts.filter(c => ['executed', 'in_delivery'].includes(c.status)).length,
      };
    });

    res.json({ counterparties: result });
  } catch (err) { next(err); }
});

router.post('/:farmId/marketing/counterparties', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, short_code, type, contact_name, contact_email, contact_phone, default_elevator_site, notes } = req.body;
    if (!name || !short_code) return res.status(400).json({ error: 'name and short_code are required' });

    const counterparty = await prisma.counterparty.create({
      data: {
        farm_id: req.params.farmId,
        name, short_code,
        type: type || 'buyer',
        contact_name: contact_name || null,
        contact_email: contact_email || null,
        contact_phone: contact_phone || null,
        default_elevator_site: default_elevator_site || null,
        notes: notes || null,
      },
    });
    res.status(201).json({ counterparty });
  } catch (err) { next(err); }
});

router.put('/:farmId/marketing/counterparties/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const existing = await prisma.counterparty.findFirst({ where: { id: req.params.id, farm_id: req.params.farmId } });
    if (!existing) return res.status(404).json({ error: 'Counterparty not found' });
    const counterparty = await prisma.counterparty.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ counterparty });
  } catch (err) { next(err); }
});

router.delete('/:farmId/marketing/counterparties/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await prisma.counterparty.findFirst({ where: { id: req.params.id, farm_id: req.params.farmId } });
    if (!existing) return res.status(404).json({ error: 'Counterparty not found' });
    const count = await prisma.marketingContract.count({ where: { counterparty_id: req.params.id } });
    if (count > 0) {
      return res.status(400).json({ error: `Cannot delete: ${count} contract(s) linked to this buyer` });
    }
    await prisma.counterparty.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
