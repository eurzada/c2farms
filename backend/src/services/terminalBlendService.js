import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('terminal:blend');

export async function getBlendEvents(farmId, { page = 1, limit = 20 } = {}) {
  try {
    const skip = (page - 1) * limit;
    const [events, total] = await Promise.all([
      prisma.terminalBlendEvent.findMany({
        where: { farm_id: farmId },
        include: {
          source_bin: { select: { id: true, bin_number: true, name: true } },
          blend_bin: { select: { id: true, bin_number: true, name: true } },
        },
        orderBy: { blend_date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.terminalBlendEvent.count({ where: { farm_id: farmId } }),
    ]);

    return {
      events,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (err) {
    logger.error('Failed to fetch blend events', { farmId, error: err.message });
    throw err;
  }
}

export async function createBlendEvent(farmId, data) {
  try {
    const sourceBinKg = (data.total_output_kg * data.source_bin_pct) / 100;
    const blendBinKg = (data.total_output_kg * data.blend_bin_pct) / 100;

    return await prisma.$transaction(async (tx) => {
      const [sourceBin, blendBin] = await Promise.all([
        tx.terminalBin.findFirst({ where: { id: data.source_bin_id, farm_id: farmId } }),
        tx.terminalBin.findFirst({ where: { id: data.blend_bin_id, farm_id: farmId } }),
      ]);

      if (!sourceBin) throw Object.assign(new Error('Source bin not found'), { status: 404 });
      if (!blendBin) throw Object.assign(new Error('Blend bin not found'), { status: 404 });

      if (sourceBin.balance_kg < sourceBinKg) {
        throw Object.assign(
          new Error(`Source bin ${sourceBin.name} has insufficient balance (${sourceBin.balance_kg} kg < ${sourceBinKg} kg)`),
          { status: 400 },
        );
      }
      if (blendBin.balance_kg < blendBinKg) {
        throw Object.assign(
          new Error(`Blend bin ${blendBin.name} has insufficient balance (${blendBin.balance_kg} kg < ${blendBinKg} kg)`),
          { status: 400 },
        );
      }

      await Promise.all([
        tx.terminalBin.update({
          where: { id: data.source_bin_id },
          data: { balance_kg: { decrement: sourceBinKg } },
        }),
        tx.terminalBin.update({
          where: { id: data.blend_bin_id },
          data: { balance_kg: { decrement: blendBinKg } },
        }),
      ]);

      const event = await tx.terminalBlendEvent.create({
        data: {
          farm_id: farmId,
          blend_date: new Date(data.blend_date),
          description: data.description,
          outbound_buyer: data.outbound_buyer,
          source_bin_id: data.source_bin_id,
          source_bin_pct: data.source_bin_pct,
          blend_bin_id: data.blend_bin_id,
          blend_bin_pct: data.blend_bin_pct,
          total_output_kg: data.total_output_kg,
          source_bin_kg: sourceBinKg,
          blend_bin_kg: blendBinKg,
          rail_car_numbers: data.rail_car_numbers || [],
          car_count: data.car_count || 0,
          target_protein: data.target_protein ?? null,
          notes: data.notes || null,
        },
        include: {
          source_bin: { select: { id: true, bin_number: true, name: true, balance_kg: true } },
          blend_bin: { select: { id: true, bin_number: true, name: true, balance_kg: true } },
        },
      });

      logger.info('Blend event created', {
        farmId,
        eventId: event.id,
        total_output_kg: data.total_output_kg,
        source_bin_kg: sourceBinKg,
        blend_bin_kg: blendBinKg,
      });
      return event;
    });
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to create blend event', { farmId, error: err.message });
    throw err;
  }
}

export async function deleteBlendEvent(farmId, eventId) {
  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.terminalBlendEvent.findFirst({
        where: { id: eventId, farm_id: farmId },
      });
      if (!event) throw Object.assign(new Error('Blend event not found'), { status: 404 });

      await Promise.all([
        tx.terminalBin.update({
          where: { id: event.source_bin_id },
          data: { balance_kg: { increment: event.source_bin_kg } },
        }),
        tx.terminalBin.update({
          where: { id: event.blend_bin_id },
          data: { balance_kg: { increment: event.blend_bin_kg } },
        }),
      ]);

      await tx.terminalBlendEvent.delete({ where: { id: eventId } });

      logger.info('Blend event deleted and balances reversed', {
        farmId,
        eventId,
        source_bin_kg_restored: event.source_bin_kg,
        blend_bin_kg_restored: event.blend_bin_kg,
      });
      return { deleted: true, reversed: { source_bin_kg: event.source_bin_kg, blend_bin_kg: event.blend_bin_kg } };
    });
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to delete blend event', { farmId, eventId, error: err.message });
    throw err;
  }
}
