import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('dispatch');

// ─── Shipment Orders ────────────────────────────────────────────────

export async function listShipmentOrders(farmId, filters = {}) {
  const where = { farm_id: farmId };
  if (filters.status) where.status = filters.status;
  if (filters.marketing_contract_id) where.marketing_contract_id = filters.marketing_contract_id;

  const orders = await prisma.shipmentOrder.findMany({
    where,
    include: {
      marketing_contract: {
        include: { counterparty: true, commodity: true },
      },
      source_location: { select: { id: true, name: true, code: true } },
      source_bin: { select: { id: true, bin_number: true } },
      creator: { select: { id: true, name: true } },
      assignments: {
        include: {
          trucker: { select: { id: true, name: true, truck_capacity_mt: true } },
          delivery_tickets: { select: { id: true, net_weight_mt: true, ticket_number: true, delivery_date: true } },
        },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  return orders.map(o => ({
    ...o,
    completed_loads: o.assignments.filter(a => a.status === 'delivered').length,
    total_delivered_mt: o.assignments
      .flatMap(a => a.delivery_tickets)
      .reduce((sum, t) => sum + (t.net_weight_mt || 0), 0),
  }));
}

export async function getShipmentOrder(orderId) {
  return prisma.shipmentOrder.findUnique({
    where: { id: orderId },
    include: {
      marketing_contract: {
        include: { counterparty: true, commodity: true },
      },
      source_location: { select: { id: true, name: true, code: true } },
      source_bin: { select: { id: true, bin_number: true } },
      creator: { select: { id: true, name: true } },
      assignments: {
        include: {
          trucker: { select: { id: true, name: true, truck_capacity_mt: true, trucker_status: true } },
          delivery_tickets: true,
        },
        orderBy: { created_at: 'asc' },
      },
    },
  });
}

export async function createShipmentOrder(farmId, data, userId) {
  const order = await prisma.shipmentOrder.create({
    data: {
      farm_id: farmId,
      marketing_contract_id: data.marketing_contract_id || null,
      source_location_id: data.source_location_id || null,
      source_bin_id: data.source_bin_id || null,
      target_loads: data.target_loads || 1,
      estimated_mt_per_load: data.estimated_mt_per_load || null,
      delivery_window_start: data.delivery_window_start ? new Date(data.delivery_window_start) : null,
      delivery_window_end: data.delivery_window_end ? new Date(data.delivery_window_end) : null,
      notes: data.notes || null,
      status: data.auto_dispatch && data.trucker_ids?.length ? 'dispatched' : 'draft',
      created_by: userId,
    },
    include: {
      marketing_contract: { include: { counterparty: true, commodity: true } },
      source_location: { select: { id: true, name: true } },
    },
  });

  // Auto-create assignments if truckers provided
  if (data.trucker_ids?.length) {
    for (const truckerId of data.trucker_ids) {
      await prisma.shipmentAssignment.create({
        data: {
          shipment_order_id: order.id,
          trucker_user_id: truckerId,
          status: data.auto_dispatch ? 'pending' : 'pending',
        },
      });
    }
  }

  logger.info(`Shipment order ${order.id} created for contract ${data.marketing_contract_id}`);
  return getShipmentOrder(order.id);
}

export async function updateShipmentOrder(orderId, data) {
  const updates = {};
  if (data.marketing_contract_id !== undefined) updates.marketing_contract_id = data.marketing_contract_id || null;
  if (data.source_location_id !== undefined) updates.source_location_id = data.source_location_id || null;
  if (data.source_bin_id !== undefined) updates.source_bin_id = data.source_bin_id || null;
  if (data.target_loads !== undefined) updates.target_loads = data.target_loads;
  if (data.estimated_mt_per_load !== undefined) updates.estimated_mt_per_load = data.estimated_mt_per_load;
  if (data.delivery_window_start !== undefined) updates.delivery_window_start = data.delivery_window_start ? new Date(data.delivery_window_start) : null;
  if (data.delivery_window_end !== undefined) updates.delivery_window_end = data.delivery_window_end ? new Date(data.delivery_window_end) : null;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.status !== undefined) updates.status = data.status;

  await prisma.shipmentOrder.update({ where: { id: orderId }, data: updates });
  return getShipmentOrder(orderId);
}

export async function dispatchOrder(orderId, truckerIds = []) {
  const order = await prisma.shipmentOrder.findUnique({
    where: { id: orderId },
    include: { assignments: true },
  });
  if (!order) throw new Error('Order not found');
  if (order.status !== 'draft') throw new Error('Only draft orders can be dispatched');

  // Create new assignments for any truckers not already assigned
  const existingTruckerIds = new Set(order.assignments.map(a => a.trucker_user_id));
  for (const truckerId of truckerIds) {
    if (!existingTruckerIds.has(truckerId)) {
      await prisma.shipmentAssignment.create({
        data: { shipment_order_id: orderId, trucker_user_id: truckerId },
      });
    }
  }

  await prisma.shipmentOrder.update({
    where: { id: orderId },
    data: { status: 'dispatched' },
  });

  logger.info(`Shipment order ${orderId} dispatched with ${truckerIds.length} truckers`);
  return getShipmentOrder(orderId);
}

export async function cancelOrder(orderId, reason) {
  await prisma.shipmentOrder.update({
    where: { id: orderId },
    data: { status: 'cancelled', notes: reason || 'Cancelled' },
  });
  // Cancel all pending assignments
  await prisma.shipmentAssignment.updateMany({
    where: { shipment_order_id: orderId, status: { in: ['pending', 'acknowledged'] } },
    data: { status: 'pending' }, // leave as-is, order status handles it
  });
  return getShipmentOrder(orderId);
}

// ─── Assignments (trucker-facing) ───────────────────────────────────

export async function getMyAssignments(farmId, userId) {
  const assignments = await prisma.shipmentAssignment.findMany({
    where: {
      trucker_user_id: userId,
      shipment_order: {
        farm_id: farmId,
        status: { in: ['dispatched', 'in_progress'] },
      },
    },
    include: {
      shipment_order: {
        include: {
          marketing_contract: {
            include: { counterparty: true, commodity: true },
          },
          source_location: { select: { id: true, name: true, code: true } },
          source_bin: { select: { id: true, bin_number: true } },
        },
      },
      delivery_tickets: { select: { id: true, net_weight_mt: true, ticket_number: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  return assignments;
}

export async function acknowledgeAssignment(assignmentId, userId) {
  const assignment = await prisma.shipmentAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.trucker_user_id !== userId) throw new Error('Assignment not found');

  await prisma.shipmentAssignment.update({
    where: { id: assignmentId },
    data: { status: 'acknowledged', acknowledged_at: new Date() },
  });

  // Transition order to in_progress if first acknowledgement
  await maybeTransitionOrder(assignment.shipment_order_id);
  return prisma.shipmentAssignment.findUnique({ where: { id: assignmentId } });
}

export async function markLoading(assignmentId, userId) {
  const assignment = await prisma.shipmentAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.trucker_user_id !== userId) throw new Error('Assignment not found');

  await prisma.shipmentAssignment.update({
    where: { id: assignmentId },
    data: { status: 'loading', loaded_at: new Date() },
  });
  await maybeTransitionOrder(assignment.shipment_order_id);
  return prisma.shipmentAssignment.findUnique({ where: { id: assignmentId } });
}

export async function markEnRoute(assignmentId, userId) {
  const assignment = await prisma.shipmentAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.trucker_user_id !== userId) throw new Error('Assignment not found');

  await prisma.shipmentAssignment.update({
    where: { id: assignmentId },
    data: { status: 'en_route' },
  });
  return prisma.shipmentAssignment.findUnique({ where: { id: assignmentId } });
}

export async function deliverAssignment(assignmentId, userId, ticketData) {
  const assignment = await prisma.shipmentAssignment.findUnique({
    where: { id: assignmentId },
    include: { shipment_order: true },
  });
  if (!assignment || assignment.trucker_user_id !== userId) throw new Error('Assignment not found');

  const order = assignment.shipment_order;

  // Create the delivery ticket, auto-linked to contract
  const netKg = ticketData.net_weight_kg || (ticketData.gross_weight_kg && ticketData.tare_weight_kg
    ? ticketData.gross_weight_kg - ticketData.tare_weight_kg : 0);

  const ticket = await prisma.deliveryTicket.create({
    data: {
      farm_id: order.farm_id,
      shipment_assignment_id: assignmentId,
      marketing_contract_id: order.marketing_contract_id,
      counterparty_id: ticketData.counterparty_id || null,
      commodity_id: ticketData.commodity_id || null,
      location_id: order.source_location_id,
      bin_id: order.source_bin_id,
      ticket_number: ticketData.ticket_number || `DSP-${Date.now()}`,
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
      source_system: 'dispatch',
      submitted_by: userId,
      notes: `Dispatched load — Order ${order.id}`,
    },
  });

  // Mark assignment as delivered
  await prisma.shipmentAssignment.update({
    where: { id: assignmentId },
    data: { status: 'delivered', delivered_at: new Date() },
  });

  // Update order completed_loads and maybe transition to complete
  const deliveredCount = await prisma.shipmentAssignment.count({
    where: { shipment_order_id: order.id, status: 'delivered' },
  });
  await prisma.shipmentOrder.update({
    where: { id: order.id },
    data: { completed_loads: deliveredCount },
  });
  await maybeCompleteOrder(order.id);

  // Recalculate contract if linked
  if (order.marketing_contract_id) {
    const { recalculateContract } = await import('./marketingService.js');
    await recalculateContract(order.marketing_contract_id);
  }

  logger.info(`Assignment ${assignmentId} delivered — ticket ${ticket.id}`);
  return { assignment: await prisma.shipmentAssignment.findUnique({ where: { id: assignmentId } }), ticket };
}

// ─── Order Status Transitions ───────────────────────────────────────

async function maybeTransitionOrder(orderId) {
  const order = await prisma.shipmentOrder.findUnique({
    where: { id: orderId },
    include: { assignments: true },
  });
  if (!order || order.status === 'complete' || order.status === 'cancelled') return;

  const hasActive = order.assignments.some(a => ['acknowledged', 'loading', 'en_route'].includes(a.status));
  if (hasActive && order.status === 'dispatched') {
    await prisma.shipmentOrder.update({ where: { id: orderId }, data: { status: 'in_progress' } });
  }
}

async function maybeCompleteOrder(orderId) {
  const order = await prisma.shipmentOrder.findUnique({
    where: { id: orderId },
    include: { assignments: true },
  });
  if (!order) return;

  const allDelivered = order.assignments.length > 0 && order.assignments.every(a => a.status === 'delivered');
  if (allDelivered && order.completed_loads >= order.target_loads) {
    await prisma.shipmentOrder.update({ where: { id: orderId }, data: { status: 'complete' } });
  }
}

// ─── Dispatch Dashboard ─────────────────────────────────────────────

export async function getDispatchDashboard(farmId) {
  const [activeOrders, truckers, recentTickets, contractQueue] = await Promise.all([
    // Active shipment orders
    prisma.shipmentOrder.findMany({
      where: { farm_id: farmId, status: { in: ['dispatched', 'in_progress'] } },
      include: {
        marketing_contract: { include: { counterparty: true, commodity: true } },
        source_location: { select: { name: true } },
        assignments: {
          include: {
            trucker: { select: { id: true, name: true } },
            delivery_tickets: { select: { net_weight_mt: true } },
          },
        },
      },
      orderBy: { delivery_window_end: 'asc' },
    }),

    // Trucker roster with status
    prisma.user.findMany({
      where: {
        farm_roles: { some: { farm_id: farmId } },
        trucker_status: { not: null },
      },
      select: {
        id: true, name: true, truck_capacity_mt: true, trucker_status: true,
        trucker_assignments: {
          where: { status: { in: ['pending', 'acknowledged', 'loading', 'en_route'] } },
          select: { id: true, status: true, shipment_order: { select: { id: true } } },
          take: 1,
        },
      },
    }),

    // Recent dispatch tickets (last 7 days)
    prisma.deliveryTicket.findMany({
      where: {
        farm_id: farmId,
        source_system: 'dispatch',
        delivery_date: { gte: new Date(Date.now() - 7 * 86400000) },
      },
      select: { id: true, net_weight_mt: true, delivery_date: true, ticket_number: true },
      orderBy: { delivery_date: 'desc' },
      take: 20,
    }),

    // Contracts with remaining volume (for dispatch planning)
    prisma.marketingContract.findMany({
      where: {
        farm_id: farmId,
        status: { in: ['executed', 'in_delivery'] },
        remaining_mt: { gt: 0 },
      },
      include: { counterparty: true, commodity: true },
      orderBy: { delivery_end: 'asc' },
    }),
  ]);

  // Enrich active orders with delivery totals
  const enrichedOrders = activeOrders.map(o => ({
    ...o,
    total_delivered_mt: o.assignments
      .flatMap(a => a.delivery_tickets)
      .reduce((sum, t) => sum + (t.net_weight_mt || 0), 0),
  }));

  return {
    active_orders: enrichedOrders,
    truckers: truckers.map(t => ({
      ...t,
      current_assignment: t.trucker_assignments[0] || null,
      is_busy: t.trucker_assignments.length > 0,
    })),
    recent_tickets: recentTickets,
    contract_queue: contractQueue.map(c => ({
      id: c.id,
      contract_number: c.contract_number,
      buyer: c.counterparty?.name,
      commodity: c.commodity?.name,
      commodity_code: c.commodity?.code,
      grade: c.grade,
      contracted_mt: c.contracted_mt,
      delivered_mt: c.delivered_mt,
      remaining_mt: c.remaining_mt,
      pct_complete: c.contracted_mt > 0 ? (c.delivered_mt / c.contracted_mt) * 100 : 0,
      delivery_end: c.delivery_end,
      elevator_site: c.elevator_site,
    })),
  };
}
