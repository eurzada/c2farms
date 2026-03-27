import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import { resolveInventoryFarm } from '../services/resolveInventoryFarm.js';
import {
  listPriorities, createPriority, updatePriority, reorderPriorities,
  claimLoad, cancelClaim, deliverClaim, getMyLoads, getActivityFeed,
} from '../services/shippingService.js';

const router = Router();

router.use('/:farmId/shipping', async (req, res, next) => {
  try {
    const { farmId } = await resolveInventoryFarm(req.params.farmId);
    req.params.farmId = farmId;
    next();
  } catch (err) { next(err); }
});

// ─── Priority Board ─────────────────────────────────────────────────

router.get('/:farmId/shipping/priorities', authenticate, async (req, res, next) => {
  try {
    const priorities = await listPriorities(req.params.farmId, req.query);
    res.json({ priorities });
  } catch (err) { next(err); }
});

router.post('/:farmId/shipping/priorities', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const priority = await createPriority(req.params.farmId, req.body, req.userId);
    const io = req.app.get('io');
    if (io) io.to(`farm:${req.params.farmId}`).emit('shipping:priority_added', { id: priority.id });
    logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'ShippingPriority', entityId: priority.id, action: 'create' });
    res.status(201).json({ priority });
  } catch (err) { next(err); }
});

router.patch('/:farmId/shipping/priorities/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const priority = await updatePriority(req.params.id, req.body);
    const io = req.app.get('io');
    if (io) io.to(`farm:${req.params.farmId}`).emit('shipping:priority_updated', { id: priority.id });
    res.json({ priority });
  } catch (err) { next(err); }
});

router.post('/:farmId/shipping/reorder', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const priorities = await reorderPriorities(req.params.farmId, req.body.ordered_ids);
    const io = req.app.get('io');
    if (io) io.to(`farm:${req.params.farmId}`).emit('shipping:reordered');
    res.json({ priorities });
  } catch (err) { next(err); }
});

// ─── Load Claims (trucker self-service) ─────────────────────────────

router.post('/:farmId/shipping/priorities/:id/claim', authenticate, async (req, res, next) => {
  try {
    const claim = await claimLoad(req.params.id, req.userId);
    const io = req.app.get('io');
    if (io) io.to(`farm:${req.params.farmId}`).emit('shipping:load_claimed', { claim_id: claim.id, trucker: claim.trucker?.name, priority_id: req.params.id });
    res.status(201).json({ claim });
  } catch (err) { next(err); }
});

router.post('/:farmId/shipping/claims/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const result = await cancelClaim(req.params.id, req.userId);
    const io = req.app.get('io');
    if (io) io.to(`farm:${req.params.farmId}`).emit('shipping:load_cancelled', { claim_id: req.params.id });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:farmId/shipping/claims/:id/deliver', authenticate, async (req, res, next) => {
  try {
    const result = await deliverClaim(req.params.id, req.userId, req.body);
    const io = req.app.get('io');
    if (io) io.to(`farm:${req.params.farmId}`).emit('shipping:load_delivered', { claim_id: req.params.id, ticket_id: result.ticket.id });
    logAudit({ farmId: req.params.farmId, userId: req.userId, entityType: 'LoadClaim', entityId: req.params.id, action: 'deliver' });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:farmId/shipping/my-loads', authenticate, async (req, res, next) => {
  try {
    const loads = await getMyLoads(req.params.farmId, req.userId);
    res.json({ loads });
  } catch (err) { next(err); }
});

// ─── Activity Feed ──────────────────────────────────────────────────

router.get('/:farmId/shipping/feed', authenticate, async (req, res, next) => {
  try {
    const feed = await getActivityFeed(req.params.farmId, parseInt(req.query.limit) || 20);
    res.json({ feed });
  } catch (err) { next(err); }
});

export default router;
