import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import { resolveInventoryFarm } from '../services/resolveInventoryFarm.js';
import {
  listShipmentOrders, getShipmentOrder, createShipmentOrder, updateShipmentOrder,
  dispatchOrder, cancelOrder, getMyAssignments, acknowledgeAssignment,
  markLoading, markEnRoute, deliverAssignment, getDispatchDashboard,
} from '../services/dispatchService.js';

const router = Router();

// Dispatch is enterprise-wide
router.use('/:farmId/dispatch', async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    req.params.farmId = farmId;
    next();
  } catch (err) { next(err); }
});

// ─── Dashboard ──────────────────────────────────────────────────────

router.get('/:farmId/dispatch/dashboard', authenticate, async (req, res, next) => {
  try {
    const data = await getDispatchDashboard(req.params.farmId);
    res.json(data);
  } catch (err) { next(err); }
});

// ─── Shipment Orders ────────────────────────────────────────────────

router.get('/:farmId/dispatch/orders', authenticate, async (req, res, next) => {
  try {
    const orders = await listShipmentOrders(req.params.farmId, req.query);
    res.json({ orders });
  } catch (err) { next(err); }
});

router.get('/:farmId/dispatch/orders/:id', authenticate, async (req, res, next) => {
  try {
    const order = await getShipmentOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order });
  } catch (err) { next(err); }
});

router.post('/:farmId/dispatch/orders', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const order = await createShipmentOrder(req.params.farmId, req.body, req.userId);
    logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'ShipmentOrder', entityId: order.id, action: 'create', changes: req.body });
    res.status(201).json({ order });
  } catch (err) { next(err); }
});

router.patch('/:farmId/dispatch/orders/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const order = await updateShipmentOrder(req.params.id, req.body);
    logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'ShipmentOrder', entityId: req.params.id, action: 'update', changes: req.body });
    res.json({ order });
  } catch (err) { next(err); }
});

router.post('/:farmId/dispatch/orders/:id/dispatch', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { trucker_ids = [] } = req.body;
    const order = await dispatchOrder(req.params.id, trucker_ids);

    // Broadcast via Socket.io
    const io = req.app.get('io');
    if (io) io.to(`farm:${req.params.farmId}`).emit('dispatch:order_dispatched', { order_id: order.id });

    logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'ShipmentOrder', entityId: req.params.id, action: 'dispatch', changes: { trucker_ids } });
    res.json({ order });
  } catch (err) { next(err); }
});

router.post('/:farmId/dispatch/orders/:id/cancel', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const order = await cancelOrder(req.params.id, req.body.reason);
    logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'ShipmentOrder', entityId: req.params.id, action: 'cancel', changes: { reason: req.body.reason } });
    res.json({ order });
  } catch (err) { next(err); }
});

// ─── Assignments (trucker-facing) ───────────────────────────────────

router.get('/:farmId/dispatch/my-assignments', authenticate, async (req, res, next) => {
  try {
    const assignments = await getMyAssignments(req.params.farmId, req.userId);
    res.json({ assignments });
  } catch (err) { next(err); }
});

router.post('/:farmId/dispatch/assignments/:id/acknowledge', authenticate, async (req, res, next) => {
  try {
    const assignment = await acknowledgeAssignment(req.params.id, req.userId);
    const io = req.app.get('io');
    if (io) io.to(`farm:${req.params.farmId}`).emit('dispatch:assignment_updated', { assignment_id: req.params.id, status: 'acknowledged' });
    res.json({ assignment });
  } catch (err) { next(err); }
});

router.post('/:farmId/dispatch/assignments/:id/loading', authenticate, async (req, res, next) => {
  try {
    const assignment = await markLoading(req.params.id, req.userId);
    const io = req.app.get('io');
    if (io) io.to(`farm:${req.params.farmId}`).emit('dispatch:assignment_updated', { assignment_id: req.params.id, status: 'loading' });
    res.json({ assignment });
  } catch (err) { next(err); }
});

router.post('/:farmId/dispatch/assignments/:id/en-route', authenticate, async (req, res, next) => {
  try {
    const assignment = await markEnRoute(req.params.id, req.userId);
    const io = req.app.get('io');
    if (io) io.to(`farm:${req.params.farmId}`).emit('dispatch:assignment_updated', { assignment_id: req.params.id, status: 'en_route' });
    res.json({ assignment });
  } catch (err) { next(err); }
});

router.post('/:farmId/dispatch/assignments/:id/deliver', authenticate, async (req, res, next) => {
  try {
    const result = await deliverAssignment(req.params.id, req.userId, req.body);
    const io = req.app.get('io');
    if (io) io.to(`farm:${req.params.farmId}`).emit('dispatch:assignment_delivered', { assignment_id: req.params.id, ticket_id: result.ticket.id });
    logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'ShipmentAssignment', entityId: req.params.id, action: 'deliver', changes: { ticket_id: result.ticket.id } });
    res.json(result);
  } catch (err) { next(err); }
});

// ─── Trucker Roster (extend existing) ───────────────────────────────

router.patch('/:farmId/dispatch/truckers/:userId', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { truck_capacity_mt, trucker_status } = req.body;
    const data = {};
    if (truck_capacity_mt !== undefined) data.truck_capacity_mt = truck_capacity_mt;
    if (trucker_status !== undefined) data.trucker_status = trucker_status;

    const user = await (await import('../config/database.js')).default.user.update({
      where: { id: req.params.userId },
      data,
      select: { id: true, name: true, truck_capacity_mt: true, trucker_status: true },
    });
    res.json({ trucker: user });
  } catch (err) { next(err); }
});

export default router;
