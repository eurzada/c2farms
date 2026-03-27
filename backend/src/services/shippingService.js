import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('shipping');

// ─── Priority Board ─────────────────────────────────────────────────

const PRIORITY_INCLUDE = {
  marketing_contract: { include: { counterparty: true, commodity: true } },
  source_location: { select: { id: true, name: true, code: true } },
  source_bin: { select: { id: true, bin_number: true } },
  creator: { select: { id: true, name: true } },
  load_claims: {
    include: {
      trucker: { select: { id: true, name: true } },
      delivery_tickets: { select: { id: true, net_weight_mt: true, ticket_number: true } },
    },
    orderBy: { started_at: 'desc' },
  },
};

export async function listPriorities(farmId, { status = 'active' } = {}) {
  const where = { farm_id: farmId };
  if (status && status !== 'all') where.status = status;

  const priorities = await prisma.shippingPriority.findMany({
    where,
    include: PRIORITY_INCLUDE,
    orderBy: { priority_rank: 'asc' },
  });

  return priorities.map(enrichPriority);
}

function enrichPriority(p) {
  const delivered = p.load_claims.filter(c => c.status === 'delivered');
  const active = p.load_claims.filter(c => c.status === 'claimed');
  const totalMt = delivered.flatMap(c => c.delivery_tickets).reduce((s, t) => s + (t.net_weight_mt || 0), 0);

  return {
    ...p,
    completed_loads: delivered.length,
    active_loads: active.length,
    total_delivered_mt: Math.round(totalMt * 100) / 100,
    active_truckers: active.map(c => c.trucker?.name).filter(Boolean),
  };
}

export async function createPriority(farmId, data, userId) {
  // Auto-rank: put at end of active list
  const maxRank = await prisma.shippingPriority.aggregate({
    where: { farm_id: farmId, status: 'active' },
    _max: { priority_rank: true },
  });

  const priority = await prisma.shippingPriority.create({
    data: {
      farm_id: farmId,
      marketing_contract_id: data.marketing_contract_id || null,
      source_location_id: data.source_location_id || null,
      source_bin_id: data.source_bin_id || null,
      priority_rank: data.priority_rank ?? (maxRank._max.priority_rank || 0) + 10,
      target_loads: data.target_loads || null,
      notes: data.notes || null,
      created_by: userId,
    },
    include: PRIORITY_INCLUDE,
  });

  logger.info(`Shipping priority created: ${priority.id}`);
  return enrichPriority(priority);
}

export async function updatePriority(priorityId, data) {
  const updates = {};
  if (data.marketing_contract_id !== undefined) updates.marketing_contract_id = data.marketing_contract_id || null;
  if (data.source_location_id !== undefined) updates.source_location_id = data.source_location_id || null;
  if (data.source_bin_id !== undefined) updates.source_bin_id = data.source_bin_id || null;
  if (data.priority_rank !== undefined) updates.priority_rank = data.priority_rank;
  if (data.target_loads !== undefined) updates.target_loads = data.target_loads;
  if (data.is_paused !== undefined) updates.is_paused = data.is_paused;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.status !== undefined) updates.status = data.status;

  const priority = await prisma.shippingPriority.update({
    where: { id: priorityId },
    data: updates,
    include: PRIORITY_INCLUDE,
  });

  return enrichPriority(priority);
}

export async function reorderPriorities(farmId, orderedIds) {
  // orderedIds is an array of priority IDs in desired order
  for (let i = 0; i < orderedIds.length; i++) {
    await prisma.shippingPriority.update({
      where: { id: orderedIds[i] },
      data: { priority_rank: (i + 1) * 10 },
    });
  }
  return listPriorities(farmId);
}

// ─── Load Claims (trucker self-service) ─────────────────────────────

export async function claimLoad(priorityId, userId) {
  const priority = await prisma.shippingPriority.findUnique({
    where: { id: priorityId },
    include: { load_claims: true },
  });
  if (!priority) throw new Error('Priority not found');
  if (priority.status !== 'active') throw new Error('This priority is not active');
  if (priority.is_paused) throw new Error('This priority is paused');

  // Check if target loads reached
  if (priority.target_loads) {
    const delivered = priority.load_claims.filter(c => c.status === 'delivered').length;
    const claimed = priority.load_claims.filter(c => c.status === 'claimed').length;
    if (delivered + claimed >= priority.target_loads) {
      throw new Error('Target loads already reached for this priority');
    }
  }

  const claim = await prisma.loadClaim.create({
    data: {
      shipping_priority_id: priorityId,
      trucker_user_id: userId,
    },
    include: {
      shipping_priority: {
        include: {
          marketing_contract: { include: { counterparty: true, commodity: true } },
          source_location: { select: { name: true } },
          source_bin: { select: { bin_number: true } },
        },
      },
      trucker: { select: { id: true, name: true } },
    },
  });

  logger.info(`Load claimed: ${claim.id} by user ${userId} for priority ${priorityId}`);
  return claim;
}

export async function cancelClaim(claimId, userId) {
  const claim = await prisma.loadClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new Error('Claim not found');
  if (claim.trucker_user_id !== userId) throw new Error('Not your claim');
  if (claim.status !== 'claimed') throw new Error('Can only cancel active claims');

  await prisma.loadClaim.update({
    where: { id: claimId },
    data: { status: 'cancelled' },
  });
  return { id: claimId, status: 'cancelled' };
}

export async function deliverClaim(claimId, userId, ticketData) {
  const claim = await prisma.loadClaim.findUnique({
    where: { id: claimId },
    include: { shipping_priority: true },
  });
  if (!claim) throw new Error('Claim not found');
  if (claim.trucker_user_id !== userId) throw new Error('Not your claim');
  if (claim.status !== 'claimed') throw new Error('Claim is not active');

  const priority = claim.shipping_priority;

  // Auto-compute net weight
  const netKg = ticketData.net_weight_kg || (ticketData.gross_weight_kg && ticketData.tare_weight_kg
    ? ticketData.gross_weight_kg - ticketData.tare_weight_kg : 0);

  const ticket = await prisma.deliveryTicket.create({
    data: {
      farm_id: priority.farm_id,
      load_claim_id: claimId,
      marketing_contract_id: priority.marketing_contract_id,
      location_id: priority.source_location_id,
      bin_id: priority.source_bin_id,
      ticket_number: ticketData.ticket_number || `SHP-${Date.now()}`,
      delivery_date: ticketData.delivery_date ? new Date(ticketData.delivery_date) : new Date(),
      gross_weight_kg: ticketData.gross_weight_kg || null,
      tare_weight_kg: ticketData.tare_weight_kg || null,
      net_weight_kg: netKg,
      net_weight_mt: netKg / 1000,
      tare_weight_mt: ticketData.tare_weight_kg ? ticketData.tare_weight_kg / 1000 : null,
      dockage_pct: ticketData.dockage_pct || null,
      moisture_pct: ticketData.moisture_pct || null,
      grade: ticketData.grade || null,
      protein_pct: ticketData.protein_pct || null,
      destination: ticketData.destination || null,
      operator_name: ticketData.operator_name || null,
      vehicle: ticketData.vehicle || null,
      source_system: 'shipping',
      submitted_by: userId,
      notes: ticketData.notes || null,
    },
  });

  await prisma.loadClaim.update({
    where: { id: claimId },
    data: { status: 'delivered', delivered_at: new Date() },
  });

  // Auto-complete priority if target loads met
  if (priority.target_loads) {
    const deliveredCount = await prisma.loadClaim.count({
      where: { shipping_priority_id: priority.id, status: 'delivered' },
    });
    if (deliveredCount >= priority.target_loads) {
      await prisma.shippingPriority.update({
        where: { id: priority.id },
        data: { status: 'done' },
      });
    }
  }

  // Recalculate contract
  if (priority.marketing_contract_id) {
    const { recalculateContract } = await import('./marketingService.js');
    await recalculateContract(priority.marketing_contract_id);
  }

  logger.info(`Load delivered: claim ${claimId}, ticket ${ticket.id}`);
  return { claim: { id: claimId, status: 'delivered' }, ticket };
}

export async function getMyLoads(farmId, userId) {
  const claims = await prisma.loadClaim.findMany({
    where: {
      trucker_user_id: userId,
      shipping_priority: { farm_id: farmId },
    },
    include: {
      shipping_priority: {
        include: {
          marketing_contract: { include: { counterparty: true, commodity: true } },
          source_location: { select: { name: true, code: true } },
          source_bin: { select: { bin_number: true } },
        },
      },
      delivery_tickets: { select: { id: true, net_weight_mt: true, ticket_number: true, delivery_date: true } },
    },
    orderBy: { started_at: 'desc' },
    take: 50,
  });
  return claims;
}

// ─── Activity Feed ──────────────────────────────────────────────────

export async function getActivityFeed(farmId, limit = 20) {
  const claims = await prisma.loadClaim.findMany({
    where: { shipping_priority: { farm_id: farmId } },
    include: {
      trucker: { select: { name: true } },
      shipping_priority: {
        select: {
          marketing_contract: { select: { contract_number: true, commodity: { select: { name: true } } } },
          source_location: { select: { name: true } },
        },
      },
      delivery_tickets: { select: { net_weight_mt: true } },
    },
    orderBy: { updated_at: 'desc' },
    take: limit,
  });

  return claims.map(c => ({
    id: c.id,
    trucker: c.trucker?.name,
    status: c.status,
    commodity: c.shipping_priority?.marketing_contract?.commodity?.name,
    contract: c.shipping_priority?.marketing_contract?.contract_number,
    location: c.shipping_priority?.source_location?.name,
    mt_delivered: c.delivery_tickets.reduce((s, t) => s + (t.net_weight_mt || 0), 0),
    started_at: c.started_at,
    delivered_at: c.delivered_at,
    updated_at: c.updated_at,
  }));
}
