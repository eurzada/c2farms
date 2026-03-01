import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getAvailableToSell } from '../services/inventoryService.js';

const router = Router();

// GET contracts with filters
router.get('/:farmId/contracts', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { status, commodity } = req.query;

    const where = { farm_id: farmId };
    if (status) where.status = status;
    if (commodity) where.commodity_id = commodity;

    const contracts = await prisma.contract.findMany({
      where,
      include: {
        commodity: true,
        deliveries: { orderBy: { delivery_date: 'desc' } },
      },
      orderBy: { created_at: 'desc' },
    });

    // Enrich with hauled totals
    const result = contracts.map(c => {
      const hauledMt = c.deliveries.reduce((s, d) => s + d.mt_delivered, 0);
      return {
        ...c,
        hauled_mt: hauledMt,
        remaining_mt: c.contracted_mt - hauledMt,
        pct_complete: c.contracted_mt > 0 ? (hauledMt / c.contracted_mt) * 100 : 0,
      };
    });

    res.json({ contracts: result });
  } catch (err) { next(err); }
});

// POST create contract
router.post('/:farmId/contracts', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { buyer, commodity_id, contracted_mt, price_per_mt, contract_number, notes } = req.body;

    if (!buyer || !commodity_id || !contracted_mt) {
      return res.status(400).json({ error: 'buyer, commodity_id, and contracted_mt are required' });
    }

    // Check oversell warning
    const available = await getAvailableToSell(farmId);
    const commodityAvail = available.find(a => a.commodity_id === commodity_id);
    const warning = commodityAvail && parseFloat(contracted_mt) > commodityAvail.available_mt
      ? `Warning: This contract exceeds available inventory by ${(parseFloat(contracted_mt) - commodityAvail.available_mt).toFixed(1)} MT`
      : null;

    const contract = await prisma.contract.create({
      data: {
        farm_id: farmId, buyer, commodity_id,
        contracted_mt: parseFloat(contracted_mt),
        price_per_mt: price_per_mt ? parseFloat(price_per_mt) : null,
        contract_number: contract_number || null,
        notes: notes || null,
      },
      include: { commodity: true },
    });

    res.status(201).json({ contract, warning });
  } catch (err) { next(err); }
});

// PUT update contract
router.put('/:farmId/contracts/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { buyer, contracted_mt, price_per_mt, status, notes, contract_number } = req.body;
    const contract = await prisma.contract.update({
      where: { id: req.params.id },
      data: {
        ...(buyer !== undefined && { buyer }),
        ...(contracted_mt !== undefined && { contracted_mt: parseFloat(contracted_mt) }),
        ...(price_per_mt !== undefined && { price_per_mt: parseFloat(price_per_mt) }),
        ...(status !== undefined && { status }),
        ...(notes !== undefined && { notes }),
        ...(contract_number !== undefined && { contract_number }),
      },
      include: { commodity: true },
    });
    res.json({ contract });
  } catch (err) { next(err); }
});

// POST record delivery
router.post('/:farmId/contracts/:id/deliveries', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { mt_delivered, delivery_date, ticket_number, notes } = req.body;

    if (!mt_delivered || !delivery_date) {
      return res.status(400).json({ error: 'mt_delivered and delivery_date are required' });
    }

    const delivery = await prisma.delivery.create({
      data: {
        farm_id: req.params.farmId,
        contract_id: req.params.id,
        mt_delivered: parseFloat(mt_delivered),
        delivery_date: new Date(delivery_date),
        ticket_number: ticket_number || null,
        notes: notes || null,
      },
    });

    // Check if contract is now fulfilled
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: { deliveries: true },
    });
    const totalHauled = contract.deliveries.reduce((s, d) => s + d.mt_delivered, 0);
    if (totalHauled >= contract.contracted_mt) {
      await prisma.contract.update({
        where: { id: req.params.id },
        data: { status: 'fulfilled' },
      });
    }

    res.status(201).json({ delivery });
  } catch (err) { next(err); }
});

// GET available to sell
router.get('/:farmId/contracts/available-to-sell', authenticate, async (req, res, next) => {
  try {
    const result = await getAvailableToSell(req.params.farmId);
    res.json({ available: result });
  } catch (err) { next(err); }
});

export default router;
