import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('terminal:ticket');

function isC2Farms(growerName) {
  if (!growerName) return false;
  const lower = growerName.toLowerCase();
  return lower.includes('c2 farms') || lower.includes('2 century');
}

export async function getTickets(farmId, {
  direction, page = 1, limit = 50, startDate, endDate, growerName, product,
} = {}) {
  try {
    const where = { farm_id: farmId };
    if (direction) where.direction = direction;
    if (product) where.product = product;
    if (growerName) where.grower_name = { contains: growerName, mode: 'insensitive' };
    if (startDate || endDate) {
      where.ticket_date = {};
      if (startDate) where.ticket_date.gte = new Date(startDate);
      if (endDate) where.ticket_date.lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;
    const [tickets, total] = await Promise.all([
      prisma.terminalTicket.findMany({
        where,
        include: {
          bin: { select: { id: true, bin_number: true, name: true } },
          samples: true,
        },
        orderBy: { ticket_date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.terminalTicket.count({ where }),
    ]);

    return {
      tickets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (err) {
    logger.error('Failed to fetch tickets', { farmId, error: err.message });
    throw err;
  }
}

export async function getNextTicketNumber(farmId) {
  try {
    const max = await prisma.terminalTicket.aggregate({
      where: { farm_id: farmId },
      _max: { ticket_number: true },
    });
    return (max._max.ticket_number || 0) + 1;
  } catch (err) {
    logger.error('Failed to get next ticket number', { farmId, error: err.message });
    throw err;
  }
}

export async function createTicket(farmId, data) {
  try {
    const c2Flag = data.is_c2_farms !== undefined ? data.is_c2_farms : isC2Farms(data.grower_name);

    return await prisma.$transaction(async (tx) => {
      const ticketNumber = data.ticket_number || await (async () => {
        const max = await tx.terminalTicket.aggregate({
          where: { farm_id: farmId },
          _max: { ticket_number: true },
        });
        return (max._max.ticket_number || 0) + 1;
      })();

      let balanceAfter = null;
      if (data.bin_id) {
        const bin = await tx.terminalBin.findFirst({
          where: { id: data.bin_id, farm_id: farmId },
        });
        if (!bin) throw Object.assign(new Error('Bin not found'), { status: 404 });

        const delta = data.direction === 'inbound' ? data.weight_kg : -data.weight_kg;
        const newBalance = bin.balance_kg + delta;
        const c2Delta = c2Flag ? delta : 0;
        const nonC2Delta = c2Flag ? 0 : delta;

        await tx.terminalBin.update({
          where: { id: data.bin_id },
          data: {
            balance_kg: newBalance,
            c2_balance_kg: bin.c2_balance_kg + c2Delta,
            non_c2_balance_kg: bin.non_c2_balance_kg + nonC2Delta,
          },
        });
        balanceAfter = newBalance;
      }

      const ticket = await tx.terminalTicket.create({
        data: {
          farm_id: farmId,
          bin_id: data.bin_id || null,
          ticket_number: ticketNumber,
          direction: data.direction,
          ticket_date: new Date(data.ticket_date),
          grower_name: data.grower_name || null,
          grower_id: data.grower_id || null,
          product: data.product,
          weight_kg: data.weight_kg,
          fmo_number: data.fmo_number || null,
          buyer: data.buyer || null,
          dockage_pct: data.dockage_pct ?? null,
          moisture_pct: data.moisture_pct ?? null,
          test_weight: data.test_weight ?? null,
          protein_pct: data.protein_pct ?? null,
          hvk_pct: data.hvk_pct ?? null,
          rail_car_number: data.rail_car_number || null,
          vehicle_id: data.vehicle_id || null,
          sold_to: data.sold_to || null,
          seal_numbers: data.seal_numbers || null,
          outbound_kg: data.outbound_kg ?? null,
          is_c2_farms: c2Flag,
          balance_after_kg: balanceAfter,
          scale_source: data.scale_source || 'manual',
          notes: data.notes || null,
        },
        include: {
          bin: { select: { id: true, bin_number: true, name: true, balance_kg: true } },
        },
      });

      logger.info('Ticket created', {
        farmId,
        ticketNumber,
        direction: data.direction,
        weight_kg: data.weight_kg,
      });
      return ticket;
    });
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to create ticket', { farmId, error: err.message });
    throw err;
  }
}

export async function updateTicket(farmId, ticketId, data) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.terminalTicket.findFirst({
        where: { id: ticketId, farm_id: farmId },
      });
      if (!existing) throw Object.assign(new Error('Ticket not found'), { status: 404 });
      if (existing.status === 'voided') {
        throw Object.assign(new Error('Cannot update a voided ticket'), { status: 400 });
      }

      // Reverse old bin effect
      if (existing.bin_id) {
        const oldDelta = existing.direction === 'inbound' ? -existing.weight_kg : existing.weight_kg;
        const oldC2Delta = existing.is_c2_farms ? oldDelta : 0;
        const oldNonC2Delta = existing.is_c2_farms ? 0 : oldDelta;
        await tx.terminalBin.update({
          where: { id: existing.bin_id },
          data: {
            balance_kg: { increment: oldDelta },
            c2_balance_kg: { increment: oldC2Delta },
            non_c2_balance_kg: { increment: oldNonC2Delta },
          },
        });
      }

      const c2Flag = data.is_c2_farms !== undefined
        ? data.is_c2_farms
        : (data.grower_name !== undefined ? isC2Farms(data.grower_name) : existing.is_c2_farms);

      const newDirection = data.direction || existing.direction;
      const newWeightKg = data.weight_kg ?? existing.weight_kg;
      const newBinId = data.bin_id !== undefined ? data.bin_id : existing.bin_id;

      let balanceAfter = null;
      if (newBinId) {
        const bin = await tx.terminalBin.findUnique({ where: { id: newBinId } });
        const delta = newDirection === 'inbound' ? newWeightKg : -newWeightKg;
        const newBalance = bin.balance_kg + delta;
        const c2Delta = c2Flag ? delta : 0;
        const nonC2Delta = c2Flag ? 0 : delta;
        await tx.terminalBin.update({
          where: { id: newBinId },
          data: {
            balance_kg: newBalance,
            c2_balance_kg: bin.c2_balance_kg + c2Delta,
            non_c2_balance_kg: bin.non_c2_balance_kg + nonC2Delta,
          },
        });
        balanceAfter = newBalance;
      }

      const updateData = {};
      const fields = [
        'bin_id', 'direction', 'grower_name', 'grower_id', 'product',
        'weight_kg', 'fmo_number', 'buyer', 'dockage_pct', 'moisture_pct',
        'test_weight', 'protein_pct', 'hvk_pct', 'rail_car_number',
        'vehicle_id', 'sold_to', 'seal_numbers', 'outbound_kg', 'notes',
      ];
      for (const f of fields) {
        if (data[f] !== undefined) updateData[f] = data[f];
      }
      if (data.ticket_date) updateData.ticket_date = new Date(data.ticket_date);
      updateData.is_c2_farms = c2Flag;
      updateData.balance_after_kg = balanceAfter;

      const updated = await tx.terminalTicket.update({
        where: { id: ticketId },
        data: updateData,
        include: {
          bin: { select: { id: true, bin_number: true, name: true, balance_kg: true } },
        },
      });

      logger.info('Ticket updated', { farmId, ticketId });
      return updated;
    });
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to update ticket', { farmId, ticketId, error: err.message });
    throw err;
  }
}

export async function voidTicket(farmId, ticketId) {
  try {
    return await prisma.$transaction(async (tx) => {
      const ticket = await tx.terminalTicket.findFirst({
        where: { id: ticketId, farm_id: farmId },
      });
      if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });
      if (ticket.status === 'voided') {
        throw Object.assign(new Error('Ticket already voided'), { status: 400 });
      }

      if (ticket.bin_id) {
        const delta = ticket.direction === 'inbound' ? -ticket.weight_kg : ticket.weight_kg;
        const c2Delta = ticket.is_c2_farms ? delta : 0;
        const nonC2Delta = ticket.is_c2_farms ? 0 : delta;
        await tx.terminalBin.update({
          where: { id: ticket.bin_id },
          data: {
            balance_kg: { increment: delta },
            c2_balance_kg: { increment: c2Delta },
            non_c2_balance_kg: { increment: nonC2Delta },
          },
        });
      }

      const voided = await tx.terminalTicket.update({
        where: { id: ticketId },
        data: { status: 'voided' },
        include: {
          bin: { select: { id: true, bin_number: true, name: true, balance_kg: true } },
        },
      });

      logger.info('Ticket voided', {
        farmId,
        ticketId,
        direction: ticket.direction,
        weight_kg: ticket.weight_kg,
      });
      return voided;
    });
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to void ticket', { farmId, ticketId, error: err.message });
    throw err;
  }
}

export async function getUnallocatedTickets(farmId) {
  try {
    return await prisma.terminalTicket.findMany({
      where: {
        farm_id: farmId,
        direction: 'inbound',
        status: 'complete',
        bin_id: null,
      },
      orderBy: { ticket_date: 'desc' },
    });
  } catch (err) {
    logger.error('Failed to fetch unallocated tickets', { farmId, error: err.message });
    throw err;
  }
}

export async function allocateTicketsToBin(farmId, binId, ticketIds) {
  try {
    return await prisma.$transaction(async (tx) => {
      const bin = await tx.terminalBin.findFirst({
        where: { id: binId, farm_id: farmId },
      });
      if (!bin) throw Object.assign(new Error('Bin not found'), { status: 404 });

      const tickets = await tx.terminalTicket.findMany({
        where: {
          id: { in: ticketIds },
          farm_id: farmId,
          direction: 'inbound',
          bin_id: null,
          status: 'complete',
        },
      });

      if (tickets.length === 0) {
        throw Object.assign(new Error('No eligible tickets found'), { status: 400 });
      }

      let totalDelta = 0;
      let c2Total = 0;
      let nonC2Total = 0;

      for (const t of tickets) {
        totalDelta += t.weight_kg;
        if (t.is_c2_farms) {
          c2Total += t.weight_kg;
        } else {
          nonC2Total += t.weight_kg;
        }
      }

      // Update bin balances in a single operation
      await tx.terminalBin.update({
        where: { id: binId },
        data: {
          balance_kg: bin.balance_kg + totalDelta,
          c2_balance_kg: bin.c2_balance_kg + c2Total,
          non_c2_balance_kg: bin.non_c2_balance_kg + nonC2Total,
        },
      });

      // Update each ticket with bin_id and balance_after_kg
      let runningBalance = bin.balance_kg;
      for (const t of tickets) {
        runningBalance += t.weight_kg;
        await tx.terminalTicket.update({
          where: { id: t.id },
          data: {
            bin_id: binId,
            balance_after_kg: runningBalance,
          },
        });
      }

      logger.info('Tickets allocated to bin', {
        farmId,
        binId,
        count: tickets.length,
        totalDelta,
        c2Total,
        nonC2Total,
      });

      return { allocated: tickets.length };
    });
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to allocate tickets to bin', { farmId, binId, error: err.message });
    throw err;
  }
}

export async function getTicketStats(farmId) {
  try {
    const tickets = await prisma.terminalTicket.findMany({
      where: { farm_id: farmId, status: 'complete' },
      select: { direction: true, weight_kg: true, product: true, grower_name: true },
    });

    let totalInboundKg = 0;
    let totalOutboundKg = 0;
    const byProduct = {};
    const byGrower = {};

    for (const t of tickets) {
      if (t.direction === 'inbound') {
        totalInboundKg += t.weight_kg;
      } else {
        totalOutboundKg += t.weight_kg;
      }

      byProduct[t.product] = (byProduct[t.product] || 0) + 1;

      if (t.grower_name) {
        byGrower[t.grower_name] = (byGrower[t.grower_name] || 0) + 1;
      }
    }

    return {
      total_inbound_kg: totalInboundKg,
      total_outbound_kg: totalOutboundKg,
      total_count: tickets.length,
      by_product: Object.entries(byProduct).map(([product, count]) => ({ product, count })),
      by_grower: Object.entries(byGrower).map(([grower_name, count]) => ({ grower_name, count })),
    };
  } catch (err) {
    logger.error('Failed to fetch ticket stats', { farmId, error: err.message });
    throw err;
  }
}
