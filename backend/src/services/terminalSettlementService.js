import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('terminal:settlements');

export async function getSettlements(farmId, { direction, status, page = 1, limit = 50 } = {}) {
  try {
    const where = { farm_id: farmId };
    if (direction) where.direction = direction;
    if (status) where.payment_status = status;

    const skip = (page - 1) * limit;
    const [settlements, total] = await Promise.all([
      prisma.terminalSettlement.findMany({
        where,
        include: {
          counterparty: { select: { id: true, name: true, short_code: true } },
          contract: {
            select: { id: true, contract_number: true, direction: true, contracted_mt: true, delivered_mt: true },
          },
        },
        orderBy: { settlement_date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.terminalSettlement.count({ where }),
    ]);

    return {
      settlements,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  } catch (err) {
    logger.error('Failed to list settlements', { farmId, error: err.message });
    throw err;
  }
}

export async function createSettlement(farmId, data) {
  try {
    return prisma.$transaction(async (tx) => {
      const settlement = await tx.terminalSettlement.create({
        data: {
          farm_id: farmId,
          settlement_number: data.settlement_number,
          direction: data.direction,
          counterparty_id: data.counterparty_id,
          contract_id: data.contract_id || null,
          settlement_date: new Date(data.settlement_date),
          gross_amount: data.gross_amount,
          deductions: data.deductions || null,
          net_amount: data.net_amount,
          payment_status: data.payment_status || 'pending',
          payment_date: data.payment_date ? new Date(data.payment_date) : null,
          payment_reference: data.payment_reference || null,
          notes: data.notes || null,
        },
        include: {
          counterparty: { select: { id: true, name: true } },
          contract: { select: { id: true, contract_number: true } },
        },
      });

      if (data.contract_id && data.settled_mt) {
        const contract = await tx.terminalContract.findUnique({
          where: { id: data.contract_id },
        });
        if (contract) {
          const newDelivered = contract.delivered_mt + data.settled_mt;
          const newRemaining = Math.max(0, contract.contracted_mt - newDelivered);
          await tx.terminalContract.update({
            where: { id: data.contract_id },
            data: {
              delivered_mt: newDelivered,
              remaining_mt: newRemaining,
              status: newRemaining <= 0 ? 'fulfilled' : 'in_delivery',
            },
          });
        }
      }

      return settlement;
    });
  } catch (err) {
    logger.error('Failed to create settlement', { farmId, error: err.message });
    throw err;
  }
}

export async function updateSettlement(farmId, settlementId, data) {
  try {
    const existing = await prisma.terminalSettlement.findFirst({
      where: { id: settlementId, farm_id: farmId },
    });
    if (!existing) throw Object.assign(new Error('Settlement not found'), { status: 404 });

    const updateData = {};
    const allowed = [
      'settlement_number', 'direction', 'counterparty_id', 'contract_id',
      'settlement_date', 'gross_amount', 'deductions', 'net_amount',
      'payment_status', 'payment_date', 'payment_reference', 'notes',
    ];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        if (key === 'settlement_date' || key === 'payment_date') {
          updateData[key] = data[key] ? new Date(data[key]) : null;
        } else {
          updateData[key] = data[key];
        }
      }
    }

    return prisma.terminalSettlement.update({
      where: { id: settlementId },
      data: updateData,
      include: {
        counterparty: { select: { id: true, name: true } },
        contract: { select: { id: true, contract_number: true } },
      },
    });
  } catch (err) {
    logger.error('Failed to update settlement', { settlementId, error: err.message });
    throw err;
  }
}

export async function markPaid(farmId, settlementId, { payment_date, payment_reference }) {
  const existing = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId },
  });
  if (!existing) throw Object.assign(new Error('Settlement not found'), { status: 404 });

  return prisma.terminalSettlement.update({
    where: { id: settlementId },
    data: {
      payment_status: existing.direction === 'payable' ? 'paid' : 'received',
      payment_date: payment_date ? new Date(payment_date) : new Date(),
      payment_reference: payment_reference || null,
    },
  });
}

export async function getSettlementSummary(farmId) {
  const settlements = await prisma.terminalSettlement.findMany({
    where: { farm_id: farmId },
    select: { direction: true, net_amount: true, payment_status: true },
  });

  const payable = settlements.filter(s => s.direction === 'payable');
  const receivable = settlements.filter(s => s.direction === 'receivable');

  return {
    payable: {
      total: payable.reduce((s, x) => s + x.net_amount, 0),
      pending: payable.filter(x => x.payment_status === 'pending').reduce((s, x) => s + x.net_amount, 0),
      paid: payable.filter(x => x.payment_status === 'paid').reduce((s, x) => s + x.net_amount, 0),
      count: payable.length,
    },
    receivable: {
      total: receivable.reduce((s, x) => s + x.net_amount, 0),
      pending: receivable.filter(x => x.payment_status === 'pending').reduce((s, x) => s + x.net_amount, 0),
      received: receivable.filter(x => x.payment_status === 'received').reduce((s, x) => s + x.net_amount, 0),
      count: receivable.length,
    },
  };
}
