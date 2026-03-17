import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('terminal:dashboard');

export async function getDashboard(farmId) {
  try {
    const [bins, recentTickets, ticketAgg] = await Promise.all([
      prisma.terminalBin.findMany({
        where: { farm_id: farmId, is_active: true },
        select: {
          id: true,
          bin_number: true,
          name: true,
          current_product_label: true,
          balance_kg: true,
          c2_balance_kg: true,
          non_c2_balance_kg: true,
          capacity_kg: true,
          commodity: { select: { id: true, name: true, code: true } },
        },
        orderBy: { bin_number: 'asc' },
      }),

      prisma.terminalTicket.findMany({
        where: { farm_id: farmId },
        include: {
          bin: { select: { id: true, bin_number: true, name: true } },
        },
        orderBy: { ticket_date: 'desc' },
        take: 20,
      }),

      prisma.terminalTicket.findMany({
        where: { farm_id: farmId, status: 'complete' },
        select: { direction: true, weight_kg: true },
      }),
    ]);

    const totalsByCommodity = {};
    for (const bin of bins) {
      const label = bin.current_product_label || bin.commodity?.name || 'Unknown';
      if (!totalsByCommodity[label]) {
        totalsByCommodity[label] = { product: label, total_kg: 0 };
      }
      totalsByCommodity[label].total_kg += bin.balance_kg;
    }

    let totalInboundCount = 0;
    let totalOutboundCount = 0;
    let totalInboundKg = 0;
    let totalOutboundKg = 0;
    for (const t of ticketAgg) {
      if (t.direction === 'inbound') {
        totalInboundCount++;
        totalInboundKg += t.weight_kg;
      } else {
        totalOutboundCount++;
        totalOutboundKg += t.weight_kg;
      }
    }

    return {
      bins: bins.map((b) => ({
        id: b.id,
        bin_number: b.bin_number,
        name: b.name,
        product_label: b.current_product_label || b.commodity?.name || null,
        balance_kg: b.balance_kg,
        c2_balance_kg: b.c2_balance_kg,
        non_c2_balance_kg: b.non_c2_balance_kg,
        capacity_kg: b.capacity_kg,
      })),
      totals_by_commodity: Object.values(totalsByCommodity),
      recent_tickets: recentTickets,
      ticket_stats: {
        total_inbound_count: totalInboundCount,
        total_outbound_count: totalOutboundCount,
        total_inbound_kg: totalInboundKg,
        total_outbound_kg: totalOutboundKg,
      },
    };
  } catch (err) {
    logger.error('Failed to fetch dashboard', { farmId, error: err.message });
    throw err;
  }
}
