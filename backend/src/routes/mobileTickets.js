import { Router } from 'express';
import multer from 'multer';
import prisma from '../config/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { extractTicketFromPhoto } from '../services/ticketVisionService.js';
import { uploadTicketPhoto } from '../services/s3Service.js';
import { logAudit } from '../services/auditService.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max for photos
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

/**
 * POST /:farmId/mobile/tickets/extract
 * Photo-only extraction — returns extracted data without saving.
 * Used by mobile app for live preview before submit.
 */
router.post('/:farmId/mobile/tickets/extract', authenticate, upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    const { extraction, confidence } = await extractTicketFromPhoto(req.file.buffer);
    res.json({ extraction, confidence });
  } catch (err) {
    // Don't let Anthropic API errors bubble as 401 (confuses mobile auth)
    const msg = err.message || String(err);
    if (msg.includes('authentication_error') || msg.includes('invalid x-api-key')) {
      return res.status(503).json({ error: 'AI extraction service unavailable — check API key' });
    }
    next(err);
  }
});

/**
 * POST /:farmId/mobile/tickets
 * Upload photo + data, create ticket. Idempotent via client_id.
 */
router.post('/:farmId/mobile/tickets', authenticate, upload.single('photo'), async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const data = req.body.data ? JSON.parse(req.body.data) : req.body;

    // Idempotency check via client_id
    if (data.client_id) {
      const existing = await prisma.deliveryTicket.findUnique({
        where: { farm_id_client_id: { farm_id: farmId, client_id: data.client_id } },
      });
      if (existing) {
        return res.status(409).json({ error: 'Duplicate submission', ticket: existing });
      }
    }

    // Extract from photo if provided and no extraction data sent
    let extraction = data.extraction_json || null;
    let confidence = data.extraction_confidence || null;
    if (req.file && !extraction) {
      const result = await extractTicketFromPhoto(req.file.buffer);
      extraction = result.extraction;
      confidence = result.confidence;
    }

    // Merge extraction with explicit overrides
    const merged = { ...(extraction || {}), ...(data.overrides || {}) };

    // Upload photo to S3
    let photoUrl = null;
    let thumbnailUrl = null;
    if (req.file) {
      try {
        const s3Result = await uploadTicketPhoto(
          farmId,
          merged.ticket_number || data.client_id || 'unknown',
          merged.delivery_date || new Date().toISOString(),
          merged.crop || 'unknown',
          req.file.buffer,
        );
        photoUrl = s3Result.photoUrl;
        thumbnailUrl = s3Result.thumbnailUrl;
      } catch (s3Err) {
        console.error('S3 upload failed, saving ticket without photo:', s3Err.message);
      }
    }

    // Resolve foreign keys
    const [commodity, counterparty, location] = await Promise.all([
      merged.crop ? prisma.commodity.findFirst({
        where: { farm_id: farmId, name: { contains: merged.crop, mode: 'insensitive' } },
      }) : null,
      merged.buyer ? prisma.counterparty.findFirst({
        where: { farm_id: farmId, name: { contains: merged.buyer, mode: 'insensitive' } },
      }) : null,
      merged.destination ? prisma.inventoryLocation.findFirst({
        where: { farm_id: farmId, name: { contains: merged.destination, mode: 'insensitive' } },
      }) : null,
    ]);

    // Resolve contract if number provided
    let marketingContract = null;
    if (merged.contract_number) {
      marketingContract = await prisma.marketingContract.findFirst({
        where: { farm_id: farmId, contract_number: merged.contract_number },
      });
    }

    // Compute net weight if missing
    let netKg = merged.net_weight_kg;
    if (!netKg && merged.gross_weight_kg && merged.tare_weight_kg) {
      netKg = merged.gross_weight_kg - merged.tare_weight_kg;
    }
    if (!netKg) {
      return res.status(400).json({ error: 'net_weight_kg is required (or provide gross and tare)' });
    }

    const ticket = await prisma.deliveryTicket.create({
      data: {
        farm_id: farmId,
        ticket_number: merged.ticket_number || `MOB-${Date.now()}`,
        delivery_date: merged.delivery_date ? new Date(merged.delivery_date) : new Date(),
        gross_weight_kg: merged.gross_weight_kg || null,
        tare_weight_kg: merged.tare_weight_kg || null,
        net_weight_kg: netKg,
        net_weight_mt: netKg / 1000,
        moisture_pct: merged.moisture_pct || null,
        grade: merged.grade || null,
        dockage_pct: merged.dockage_pct || null,
        protein_pct: merged.protein_pct || null,
        operator_name: merged.operator_name || null,
        vehicle: merged.vehicle || null,
        destination: merged.destination || null,
        crop_year: merged.delivery_date ? new Date(merged.delivery_date).getFullYear() : new Date().getFullYear(),
        source_system: 'mobile',
        source_ref: merged.load_id || null,
        source_ticket_number: merged.ticket_number || null,
        notes: merged.notes || null,
        commodity_id: commodity?.id || null,
        counterparty_id: counterparty?.id || null,
        location_id: location?.id || null,
        marketing_contract_id: marketingContract?.id || null,
        photo_url: photoUrl,
        photo_thumbnail_url: thumbnailUrl,
        extraction_json: extraction,
        extraction_confidence: confidence,
        submitted_by: req.userId,
        mobile_submitted_at: data.device_timestamp ? new Date(data.device_timestamp) : new Date(),
        client_id: data.client_id || null,
      },
      include: {
        commodity: { select: { name: true } },
        counterparty: { select: { name: true } },
        location: { select: { name: true } },
      },
    });

    // Emit Socket.io event if available
    const io = req.app.get('io');
    if (io) {
      io.to(`farm:${farmId}`).emit('ticket-created', {
        ticket: {
          id: ticket.id,
          ticket_number: ticket.ticket_number,
          delivery_date: ticket.delivery_date,
          net_weight_mt: ticket.net_weight_mt,
          commodity: ticket.commodity,
          counterparty: ticket.counterparty,
          source_system: 'mobile',
          photo_thumbnail_url: ticket.photo_thumbnail_url,
        },
      });
    }

    logAudit({
      farmId,
      userId: req.userId,
      entityType: 'DeliveryTicket',
      entityId: ticket.id,
      action: 'mobile_create',
      changes: { ticket_number: ticket.ticket_number, client_id: data.client_id },
    });

    res.status(201).json({ ticket });
  } catch (err) { next(err); }
});

/**
 * PATCH /:farmId/mobile/tickets/:id
 * Trucker corrections before final submit.
 */
router.patch('/:farmId/mobile/tickets/:id', authenticate, async (req, res, next) => {
  try {
    const { farmId, id } = req.params;
    const updates = req.body;

    const existing = await prisma.deliveryTicket.findFirst({
      where: { id, farm_id: farmId, submitted_by: req.userId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Ticket not found or not yours' });
    }

    // Recompute net weight if gross/tare changed
    const grossKg = updates.gross_weight_kg ?? existing.gross_weight_kg;
    const tareKg = updates.tare_weight_kg ?? existing.tare_weight_kg;
    let netKg = updates.net_weight_kg ?? existing.net_weight_kg;
    if (updates.gross_weight_kg !== undefined || updates.tare_weight_kg !== undefined) {
      if (grossKg && tareKg) netKg = grossKg - tareKg;
    }

    const allowedFields = [
      'ticket_number', 'delivery_date', 'gross_weight_kg', 'tare_weight_kg',
      'moisture_pct', 'grade', 'dockage_pct', 'protein_pct',
      'operator_name', 'vehicle', 'destination', 'notes',
    ];
    const data = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) data[field] = updates[field];
    }
    if (updates.delivery_date) data.delivery_date = new Date(updates.delivery_date);
    data.net_weight_kg = netKg;
    data.net_weight_mt = netKg / 1000;

    const ticket = await prisma.deliveryTicket.update({
      where: { id },
      data,
      include: {
        commodity: { select: { name: true } },
        counterparty: { select: { name: true } },
        location: { select: { name: true } },
      },
    });

    res.json({ ticket });
  } catch (err) { next(err); }
});

/**
 * GET /:farmId/mobile/tickets/mine
 * Trucker's own submitted tickets (most recent first).
 */
router.get('/:farmId/mobile/tickets/mine', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const [tickets, total] = await Promise.all([
      prisma.deliveryTicket.findMany({
        where: { farm_id: farmId, submitted_by: req.userId },
        select: {
          id: true,
          ticket_number: true,
          delivery_date: true,
          net_weight_kg: true,
          net_weight_mt: true,
          grade: true,
          moisture_pct: true,
          photo_thumbnail_url: true,
          source_system: true,
          created_at: true,
          commodity: { select: { name: true } },
          counterparty: { select: { name: true } },
          location: { select: { name: true } },
        },
        orderBy: { created_at: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.deliveryTicket.count({ where: { farm_id: farmId, submitted_by: req.userId } }),
    ]);

    res.json({ tickets, total });
  } catch (err) { next(err); }
});

/**
 * GET /:farmId/mobile/lookup-data
 * Reference data for mobile app caching (commodities, locations, bins, counterparties, contracts).
 */
router.get('/:farmId/mobile/lookup-data', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.params;

    const [commodities, locations, bins, counterparties, contracts] = await Promise.all([
      prisma.commodity.findMany({
        where: { farm_id: farmId },
        select: { id: true, name: true, code: true, lbs_per_bu: true },
        orderBy: { name: 'asc' },
      }),
      prisma.inventoryLocation.findMany({
        where: { farm_id: farmId },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      prisma.inventoryBin.findMany({
        where: { location: { farm_id: farmId } },
        select: { id: true, bin_number: true, location_id: true, commodity_id: true },
        orderBy: { bin_number: 'asc' },
      }),
      prisma.counterparty.findMany({
        where: { farm_id: farmId },
        select: { id: true, name: true, short_code: true },
        orderBy: { name: 'asc' },
      }),
      prisma.marketingContract.findMany({
        where: { farm_id: farmId, status: { in: ['executed', 'in_delivery'] } },
        select: { id: true, contract_number: true, commodity: { select: { name: true } }, counterparty: { select: { name: true } } },
        orderBy: { contract_number: 'asc' },
      }),
    ]);

    res.json({ commodities, locations, bins, counterparties, contracts });
  } catch (err) { next(err); }
});

export default router;
