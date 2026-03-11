import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('terminal:sample');

export async function getSamples(farmId, { page = 1, limit = 50 } = {}) {
  try {
    const skip = (page - 1) * limit;
    const [samples, total] = await Promise.all([
      prisma.terminalSample.findMany({
        where: { ticket: { farm_id: farmId } },
        include: {
          ticket: {
            select: {
              id: true,
              ticket_number: true,
              product: true,
              grower_name: true,
              ticket_date: true,
              direction: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.terminalSample.count({ where: { ticket: { farm_id: farmId } } }),
    ]);

    return {
      samples,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (err) {
    logger.error('Failed to fetch samples', { farmId, error: err.message });
    throw err;
  }
}

export async function createSample(ticketId, data) {
  try {
    const ticket = await prisma.terminalTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });

    const sample = await prisma.terminalSample.create({
      data: {
        ticket_id: ticketId,
        inspector: data.inspector,
        sample_type: data.sample_type,
        send_date: data.send_date ? new Date(data.send_date) : null,
        tracking_number: data.tracking_number || null,
        notes: data.notes || null,
      },
      include: {
        ticket: {
          select: { id: true, ticket_number: true, product: true },
        },
      },
    });

    logger.info('Sample created', { ticketId, sampleId: sample.id, sample_type: data.sample_type });
    return sample;
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to create sample', { ticketId, error: err.message });
    throw err;
  }
}

export async function updateSample(sampleId, data) {
  try {
    const existing = await prisma.terminalSample.findUnique({ where: { id: sampleId } });
    if (!existing) throw Object.assign(new Error('Sample not found'), { status: 404 });

    const updateData = {};
    if (data.inspector !== undefined) updateData.inspector = data.inspector;
    if (data.sample_type !== undefined) updateData.sample_type = data.sample_type;
    if (data.send_date !== undefined) updateData.send_date = data.send_date ? new Date(data.send_date) : null;
    if (data.tracking_number !== undefined) updateData.tracking_number = data.tracking_number;
    if (data.notes !== undefined) updateData.notes = data.notes;

    const updated = await prisma.terminalSample.update({
      where: { id: sampleId },
      data: updateData,
      include: {
        ticket: {
          select: { id: true, ticket_number: true, product: true },
        },
      },
    });

    logger.info('Sample updated', { sampleId });
    return updated;
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to update sample', { sampleId, error: err.message });
    throw err;
  }
}

export async function deleteSample(sampleId) {
  try {
    const existing = await prisma.terminalSample.findUnique({ where: { id: sampleId } });
    if (!existing) throw Object.assign(new Error('Sample not found'), { status: 404 });

    await prisma.terminalSample.delete({ where: { id: sampleId } });

    logger.info('Sample deleted', { sampleId });
    return { deleted: true };
  } catch (err) {
    if (err.status) throw err;
    logger.error('Failed to delete sample', { sampleId, error: err.message });
    throw err;
  }
}
