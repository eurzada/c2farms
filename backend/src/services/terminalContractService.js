import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('terminal:contracts');

export async function getContracts(farmId, { direction, status, page = 1, limit = 50 } = {}) {
  try {
    const where = { farm_id: farmId };
    if (direction) where.direction = direction;
    if (status) where.status = status;

    const skip = (page - 1) * limit;
    const [contracts, total] = await Promise.all([
      prisma.terminalContract.findMany({
        where,
        include: {
          counterparty: { select: { id: true, name: true, short_code: true } },
          commodity: { select: { id: true, name: true, code: true } },
          _count: { select: { settlements: true } },
        },
        orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.terminalContract.count({ where }),
    ]);

    return {
      contracts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  } catch (err) {
    logger.error('Failed to list contracts', { farmId, error: err.message });
    throw err;
  }
}

export async function getContract(farmId, contractId) {
  const contract = await prisma.terminalContract.findFirst({
    where: { id: contractId, farm_id: farmId },
    include: {
      counterparty: true,
      commodity: true,
      settlements: {
        include: { counterparty: { select: { id: true, name: true } } },
        orderBy: { settlement_date: 'desc' },
      },
    },
  });
  if (!contract) {
    throw Object.assign(new Error('Contract not found'), { status: 404 });
  }
  return contract;
}

export async function createContract(farmId, data) {
  try {
    const remaining = data.contracted_mt - (data.delivered_mt || 0);
    const contract = await prisma.terminalContract.create({
      data: {
        farm_id: farmId,
        contract_number: data.contract_number,
        direction: data.direction,
        counterparty_id: data.counterparty_id,
        commodity_id: data.commodity_id,
        contracted_mt: data.contracted_mt,
        delivered_mt: data.delivered_mt || 0,
        remaining_mt: remaining,
        price_per_mt: data.price_per_mt || null,
        ship_mode: data.ship_mode || null,
        delivery_point: data.delivery_point || null,
        start_date: data.start_date ? new Date(data.start_date) : null,
        end_date: data.end_date ? new Date(data.end_date) : null,
        status: data.status || 'executed',
        notes: data.notes || null,
      },
      include: {
        counterparty: { select: { id: true, name: true } },
        commodity: { select: { id: true, name: true, code: true } },
      },
    });
    return contract;
  } catch (err) {
    logger.error('Failed to create contract', { farmId, error: err.message });
    throw err;
  }
}

export async function updateContract(farmId, contractId, data, io) {
  try {
    const existing = await prisma.terminalContract.findFirst({
      where: { id: contractId, farm_id: farmId },
    });
    if (!existing) throw Object.assign(new Error('Contract not found'), { status: 404 });

    const updateData = {};
    const allowed = [
      'contract_number', 'direction', 'counterparty_id', 'commodity_id',
      'contracted_mt', 'delivered_mt', 'price_per_mt', 'ship_mode',
      'delivery_point', 'start_date', 'end_date', 'status', 'notes',
      'grade_prices_json', 'blend_requirement_json',
    ];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        if (key === 'start_date' || key === 'end_date') {
          updateData[key] = data[key] ? new Date(data[key]) : null;
        } else {
          updateData[key] = data[key];
        }
      }
    }

    const contracted = updateData.contracted_mt ?? existing.contracted_mt;
    const delivered = updateData.delivered_mt ?? existing.delivered_mt;
    updateData.remaining_mt = contracted - delivered;

    if (updateData.remaining_mt <= 0 && updateData.status !== 'cancelled') {
      updateData.status = 'fulfilled';
    }

    const updated = await prisma.terminalContract.update({
      where: { id: contractId },
      data: updateData,
      include: {
        counterparty: { select: { id: true, name: true } },
        commodity: { select: { id: true, name: true, code: true } },
      },
    });

    // Sync blend fields to linked marketing contract if changed
    if (data.grade_prices_json !== undefined || data.blend_requirement_json !== undefined) {
      const syncFields = {};
      if (data.grade_prices_json !== undefined) syncFields.grade_prices_json = data.grade_prices_json;
      if (data.blend_requirement_json !== undefined) syncFields.blend_requirement_json = data.blend_requirement_json;
      await syncToMarketingMirror(contractId, syncFields, io);
    }

    return updated;
  } catch (err) {
    logger.error('Failed to update contract', { contractId, error: err.message });
    throw err;
  }
}

export async function addDelivery(farmId, contractId, mt) {
  return prisma.$transaction(async (tx) => {
    const contract = await tx.terminalContract.findFirst({
      where: { id: contractId, farm_id: farmId },
    });
    if (!contract) throw Object.assign(new Error('Contract not found'), { status: 404 });

    const newDelivered = contract.delivered_mt + mt;
    const rawRemaining = contract.contracted_mt - newDelivered;
    const newRemaining = rawRemaining < 0.5 ? 0 : rawRemaining; // tolerance for floating-point dust
    const newStatus = newRemaining <= 0 ? 'fulfilled' : 'in_delivery';

    return tx.terminalContract.update({
      where: { id: contractId },
      data: {
        delivered_mt: newDelivered,
        remaining_mt: newRemaining,
        status: newStatus,
      },
    });
  });
}

/**
 * Sync grade_prices_json and/or blend_requirement_json from a TerminalContract
 * to the linked MarketingContract (transfer agreement).
 */
export async function syncToMarketingMirror(contractId, updatedFields, io) {
  try {
    const marketingContract = await prisma.marketingContract.findFirst({
      where: { linked_terminal_contract_id: contractId },
    });
    if (!marketingContract) return null;

    const updateData = { blend_mix_updated_at: new Date() };
    if (updatedFields.grade_prices_json !== undefined) {
      updateData.grade_prices_json = updatedFields.grade_prices_json;
    }
    if (updatedFields.blend_requirement_json !== undefined) {
      updateData.blend_requirement_json = updatedFields.blend_requirement_json;
    }

    const updated = await prisma.marketingContract.update({
      where: { id: marketingContract.id },
      data: updateData,
    });

    if (io) {
      const enterpriseFarm = await prisma.farm.findFirst({
        where: { is_enterprise: true },
        select: { id: true },
      });
      if (enterpriseFarm) {
        io.to(enterpriseFarm.id).emit('marketing:blend_mix_updated', {
          contract_id: marketingContract.id,
        });
      }
    }

    logger.info('Synced blend fields to marketing contract', {
      terminalContractId: contractId,
      marketingContractId: marketingContract.id,
    });
    return updated;
  } catch (err) {
    logger.error('Failed to sync to marketing mirror', { contractId, error: err.message });
    // Don't throw — sync failure shouldn't break the contract update
  }
}

export async function getContractSummary(farmId) {
  const contracts = await prisma.terminalContract.findMany({
    where: { farm_id: farmId, status: { not: 'cancelled' } },
    include: {
      counterparty: { select: { name: true } },
      commodity: { select: { name: true, code: true } },
    },
  });

  const purchase = contracts.filter(c => c.direction === 'purchase');
  const sale = contracts.filter(c => c.direction === 'sale');

  return {
    purchase: {
      count: purchase.length,
      total_contracted_mt: purchase.reduce((s, c) => s + c.contracted_mt, 0),
      total_delivered_mt: purchase.reduce((s, c) => s + c.delivered_mt, 0),
      total_remaining_mt: purchase.reduce((s, c) => s + c.remaining_mt, 0),
    },
    sale: {
      count: sale.length,
      total_contracted_mt: sale.reduce((s, c) => s + c.contracted_mt, 0),
      total_delivered_mt: sale.reduce((s, c) => s + c.delivered_mt, 0),
      total_remaining_mt: sale.reduce((s, c) => s + c.remaining_mt, 0),
    },
    contracts,
  };
}
