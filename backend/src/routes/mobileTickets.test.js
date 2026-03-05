import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock dependencies
vi.mock('../config/database.js', () => {
  const mockPrisma = {
    deliveryTicket: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    commodity: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    inventoryLocation: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    inventoryBin: { findMany: vi.fn().mockResolvedValue([]) },
    counterparty: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    marketingContract: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
  };
  return { default: mockPrisma };
});

vi.mock('../services/ticketVisionService.js', () => ({
  extractTicketFromPhoto: vi.fn().mockResolvedValue({
    extraction: { ticket_number: 'TKT-001', net_weight_kg: 30000, crop: 'Canola' },
    confidence: 0.85,
  }),
}));

vi.mock('../services/s3Service.js', () => ({
  uploadTicketPhoto: vi.fn().mockResolvedValue({
    photoUrl: 'https://s3.example.com/photo.jpg',
    thumbnailUrl: 'https://s3.example.com/thumb.jpg',
  }),
}));

vi.mock('../services/auditService.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.userId = 'user-1'; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

describe('mobileTickets routes', () => {
  let app;
  let prisma;

  beforeEach(async () => {
    vi.clearAllMocks();

    const dbMod = await import('../config/database.js');
    prisma = dbMod.default;

    const routesMod = await import('./mobileTickets.js');
    app = express();
    app.use(express.json());
    app.use('/api/farms', routesMod.default);
  });

  describe('POST /:farmId/mobile/tickets/extract', () => {
    it('returns extraction from photo', async () => {
      const res = await request(app)
        .post('/api/farms/farm-1/mobile/tickets/extract')
        .attach('photo', Buffer.from('fake-image'), 'ticket.jpg');

      expect(res.status).toBe(200);
      expect(res.body.extraction.ticket_number).toBe('TKT-001');
      expect(res.body.confidence).toBe(0.85);
    });

    it('returns 400 without photo', async () => {
      const res = await request(app)
        .post('/api/farms/farm-1/mobile/tickets/extract');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No photo');
    });
  });

  describe('POST /:farmId/mobile/tickets', () => {
    it('creates a ticket and returns 201', async () => {
      prisma.deliveryTicket.findUnique.mockResolvedValue(null); // no duplicate
      prisma.deliveryTicket.create.mockResolvedValue({
        id: 'ticket-1',
        ticket_number: 'TKT-001',
        net_weight_kg: 30000,
        net_weight_mt: 30,
        delivery_date: '2026-03-01',
        source_system: 'mobile',
        commodity: { name: 'Canola' },
        counterparty: null,
        location: null,
      });

      const res = await request(app)
        .post('/api/farms/farm-1/mobile/tickets')
        .attach('photo', Buffer.from('fake-image'), 'ticket.jpg')
        .field('data', JSON.stringify({
          client_id: 'client-uuid-123',
          overrides: { ticket_number: 'TKT-001', delivery_date: '2026-03-01' },
        }));

      expect(res.status).toBe(201);
      expect(res.body.ticket.id).toBe('ticket-1');
    });

    it('returns 409 for duplicate client_id', async () => {
      prisma.deliveryTicket.findUnique.mockResolvedValue({
        id: 'existing-ticket',
        client_id: 'client-uuid-123',
      });

      const res = await request(app)
        .post('/api/farms/farm-1/mobile/tickets')
        .field('data', JSON.stringify({
          client_id: 'client-uuid-123',
          overrides: { ticket_number: 'TKT-001', net_weight_kg: 30000, delivery_date: '2026-03-01' },
        }));

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('Duplicate');
    });
  });

  describe('GET /:farmId/mobile/tickets/mine', () => {
    it('returns user tickets', async () => {
      prisma.deliveryTicket.findMany.mockResolvedValue([
        { id: 't1', ticket_number: 'TKT-001', net_weight_mt: 30 },
      ]);
      prisma.deliveryTicket.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/api/farms/farm-1/mobile/tickets/mine');

      expect(res.status).toBe(200);
      expect(res.body.tickets).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });
  });

  describe('GET /:farmId/mobile/lookup-data', () => {
    it('returns reference data', async () => {
      const res = await request(app)
        .get('/api/farms/farm-1/mobile/lookup-data');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('commodities');
      expect(res.body).toHaveProperty('locations');
      expect(res.body).toHaveProperty('bins');
      expect(res.body).toHaveProperty('counterparties');
      expect(res.body).toHaveProperty('contracts');
    });
  });
});
