import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('terminal:bin');

export async function getBins(farmId) {
  try {
    return await prisma.terminalBin.findMany({
      where: { farm_id: farmId },
      include: {
        commodity: { select: { id: true, name: true, code: true } },
      },
      orderBy: { bin_number: 'asc' },
    });
  } catch (err) {
    logger.error('Failed to fetch bins', { farmId, error: err.message });
    throw err;
  }
}

export async function getBinLedger(farmId, binId, { page = 1, limit = 50 } = {}) {
  try {
    const bin = await prisma.terminalBin.findFirst({
      where: { id: binId, farm_id: farmId },
      include: { commodity: { select: { id: true, name: true, code: true } } },
    });
    if (!bin) throw Object.assign(new Error('Bin not found'), { status: 404 });

    const skip = (page - 1) * limit;

    const [tickets, totalTickets, blendEvents] = await Promise.all([
      prisma.terminalTicket.findMany({
        where: { bin_id: binId, farm_id: farmId, status: 'complete' },
        orderBy: { ticket_date: 'asc' },
        skip,
        take: limit,
        include: { contract: { select: { id: true, contract_number: true, counterparty: { select: { name: true } } } } },
      }),
      prisma.terminalTicket.count({
        where: { bin_id: binId, farm_id: farmId, status: 'complete' },
      }),
      prisma.terminalBlendEvent.findMany({
        where: {
          farm_id: farmId,
          OR: [{ source_bin_id: binId }, { blend_bin_id: binId }],
        },
        orderBy: { blend_date: 'asc' },
      }),
    ]);

    let runningBalance = 0;
    if (page > 1) {
      const prior = await prisma.terminalTicket.findMany({
        where: { bin_id: binId, farm_id: farmId, status: 'complete' },
        orderBy: { ticket_date: 'asc' },
        take: skip,
        select: { direction: true, weight_kg: true },
      });
      for (const t of prior) {
        runningBalance += t.direction === 'inbound' ? t.weight_kg : -t.weight_kg;
      }
    }

    const ledger = tickets.map((t) => {
      const delta = t.direction === 'inbound' ? t.weight_kg : -t.weight_kg;
      runningBalance += delta;
      return { ...t, running_balance_kg: runningBalance };
    });

    return {
      bin,
      tickets: ledger,
      blend_events: blendEvents,
      pagination: {
        page,
        limit,
        total: totalTickets,
        totalPages: Math.ceil(totalTickets / limit),
      },
    };
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to fetch bin ledger', { farmId, binId, error: err.message });
    throw err;
  }
}

export async function updateBin(farmId, binId, data) {
  try {
    const bin = await prisma.terminalBin.findFirst({
      where: { id: binId, farm_id: farmId },
    });
    if (!bin) throw Object.assign(new Error('Bin not found'), { status: 404 });

    const allowed = ['name', 'current_product_label', 'capacity_kg', 'notes'];
    const update = {};
    for (const key of allowed) {
      if (data[key] !== undefined) update[key] = data[key];
    }

    return await prisma.terminalBin.update({
      where: { id: binId },
      data: update,
    });
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to update bin', { farmId, binId, error: err.message });
    throw err;
  }
}

export async function sweepClean(farmId, binId, newCommodityId, newProductLabel) {
  try {
    const bin = await prisma.terminalBin.findFirst({
      where: { id: binId, farm_id: farmId },
    });
    if (!bin) throw Object.assign(new Error('Bin not found'), { status: 404 });

    const update = {
      balance_kg: 0,
      c2_balance_kg: 0,
      non_c2_balance_kg: 0,
      swept_clean_at: new Date(),
    };
    if (newCommodityId) update.current_commodity_id = newCommodityId;
    if (newProductLabel) update.current_product_label = newProductLabel;

    const updated = await prisma.terminalBin.update({
      where: { id: binId },
      data: update,
    });

    logger.info('Bin swept clean', { farmId, binId, newCommodityId });
    return updated;
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to sweep bin', { farmId, binId, error: err.message });
    throw err;
  }
}

export async function recalculateBalance(farmId, binId) {
  try {
    const bin = await prisma.terminalBin.findFirst({
      where: { id: binId, farm_id: farmId },
    });
    if (!bin) throw Object.assign(new Error('Bin not found'), { status: 404 });

    const tickets = await prisma.terminalTicket.findMany({
      where: { bin_id: binId, farm_id: farmId, status: 'complete' },
      orderBy: { ticket_date: 'asc' },
    });

    const blendEvents = await prisma.terminalBlendEvent.findMany({
      where: {
        farm_id: farmId,
        OR: [{ source_bin_id: binId }, { blend_bin_id: binId }],
      },
    });

    let balance = 0;
    let c2Balance = 0;
    let nonC2Balance = 0;

    for (const t of tickets) {
      const kg = t.direction === 'inbound' ? t.weight_kg : -t.weight_kg;
      balance += kg;
      if (t.is_c2_farms) {
        c2Balance += kg;
      } else {
        nonC2Balance += kg;
      }
    }

    for (const evt of blendEvents) {
      if (evt.source_bin_id === binId) balance -= evt.source_bin_kg;
      if (evt.blend_bin_id === binId) balance -= evt.blend_bin_kg;
    }

    const updated = await prisma.terminalBin.update({
      where: { id: binId },
      data: {
        balance_kg: balance,
        c2_balance_kg: c2Balance,
        non_c2_balance_kg: nonC2Balance,
      },
    });

    logger.info('Bin balance recalculated', {
      farmId,
      binId,
      balance_kg: balance,
      c2_balance_kg: c2Balance,
      non_c2_balance_kg: nonC2Balance,
    });
    return updated;
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to recalculate bin balance', { farmId, binId, error: err.message });
    throw err;
  }
}
