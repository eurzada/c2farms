import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPrismaMock } from '../__mocks__/prismaClient.js';

const prismaMock = createPrismaMock();

vi.mock('../config/database.js', () => ({ default: prismaMock }));

vi.mock('../middleware/auth.js', () => ({
  authenticate: (_req, _res, next) => {
    _req.userId = 'user-1';
    next();
  },
  requireFarmAccess: (_req, _res, next) => {
    _req.farmRole = 'admin';
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const mockSvc = {
  getPlan: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  bulkUpdateSeasons: vi.fn(),
  pushToForecast: vi.fn(),
  getDashboard: vi.fn(),
  bulkUpdatePlanStatus: vi.fn(),
  bulkPushToForecast: vi.fn(),
  copyFromPriorYear: vi.fn(),
};

vi.mock('../services/labourService.js', () => mockSvc);

const { default: labourRoutes, labourGeneralRouter } = await import('./labour.js');
const { authenticate, requireFarmAccess } = await import('../middleware/auth.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/labour', labourGeneralRouter);
  app.use('/api/farms/:farmId', authenticate, requireFarmAccess);
  app.use('/api/farms', labourRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

const FARM_ID = 'farm-1';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Farm-scoped routes ─────────────────────────────────────────────

describe('GET /api/farms/:farmId/labour/plan', () => {
  it('returns plan for given year', async () => {
    const plan = { id: 'p1', fiscal_year: 2026, seasons: [] };
    mockSvc.getPlan.mockResolvedValue(plan);

    const res = await request(createApp())
      .get(`/api/farms/${FARM_ID}/labour/plan?year=2026`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(plan);
    expect(mockSvc.getPlan).toHaveBeenCalledWith(FARM_ID, 2026);
  });

  it('returns null when no plan exists', async () => {
    mockSvc.getPlan.mockResolvedValue(null);

    const res = await request(createApp())
      .get(`/api/farms/${FARM_ID}/labour/plan?year=2026`);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('defaults to year 2026', async () => {
    mockSvc.getPlan.mockResolvedValue(null);

    await request(createApp())
      .get(`/api/farms/${FARM_ID}/labour/plan`);

    expect(mockSvc.getPlan).toHaveBeenCalledWith(FARM_ID, 2026);
  });
});

describe('POST /api/farms/:farmId/labour/plan', () => {
  it('creates a new plan', async () => {
    const plan = { id: 'p1', fiscal_year: 2026 };
    mockSvc.createPlan.mockResolvedValue(plan);

    const res = await request(createApp())
      .post(`/api/farms/${FARM_ID}/labour/plan`)
      .send({ fiscal_year: 2026, avg_wage: 32 });

    expect(res.status).toBe(201);
    expect(mockSvc.createPlan).toHaveBeenCalledWith(FARM_ID, 2026, 32);
  });
});

describe('PATCH /api/farms/:farmId/labour/plan/:planId', () => {
  it('updates plan fields', async () => {
    mockSvc.updatePlan.mockResolvedValue({ id: 'p1', avg_wage: 35 });

    const res = await request(createApp())
      .patch(`/api/farms/${FARM_ID}/labour/plan/p1`)
      .send({ avg_wage: 35 });

    expect(res.status).toBe(200);
    expect(mockSvc.updatePlan).toHaveBeenCalledWith('p1', { avg_wage: 35 });
  });
});

describe('PUT /api/farms/:farmId/labour/plan/:planId/seasons', () => {
  it('bulk updates seasons', async () => {
    const updated = { id: 'p1', seasons: [] };
    mockSvc.bulkUpdateSeasons.mockResolvedValue(updated);

    const seasons = [{ name: 'Test', sort_order: 1, months: ['May'], roles: [] }];
    const res = await request(createApp())
      .put(`/api/farms/${FARM_ID}/labour/plan/p1/seasons`)
      .send({ seasons });

    expect(res.status).toBe(200);
    expect(mockSvc.bulkUpdateSeasons).toHaveBeenCalledWith('p1', seasons);
  });
});

describe('POST /api/farms/:farmId/labour/plan/:planId/push', () => {
  it('pushes labour to forecast', async () => {
    mockSvc.pushToForecast.mockResolvedValue({ pushed: true, monthsUpdated: ['May', 'Sep'] });

    const res = await request(createApp())
      .post(`/api/farms/${FARM_ID}/labour/plan/p1/push`);

    expect(res.status).toBe(200);
    expect(res.body.pushed).toBe(true);
    expect(res.body.monthsUpdated).toEqual(['May', 'Sep']);
  });
});

describe('GET /api/farms/:farmId/labour/dashboard', () => {
  it('returns dashboard data', async () => {
    const dashboard = { total_hours: 1400, total_cost: 44800 };
    mockSvc.getDashboard.mockResolvedValue(dashboard);

    const res = await request(createApp())
      .get(`/api/farms/${FARM_ID}/labour/dashboard?year=2026`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(dashboard);
  });
});

describe('POST /api/farms/:farmId/labour/plan/copy-from-prior', () => {
  it('copies plan from prior year', async () => {
    const plan = { id: 'p-new', fiscal_year: 2026 };
    mockSvc.copyFromPriorYear.mockResolvedValue(plan);

    const res = await request(createApp())
      .post(`/api/farms/${FARM_ID}/labour/plan/copy-from-prior`)
      .send({ fiscal_year: 2026 });

    expect(res.status).toBe(201);
    expect(mockSvc.copyFromPriorYear).toHaveBeenCalledWith(FARM_ID, 2026);
  });

  it('returns 404 when no prior year plan exists', async () => {
    mockSvc.copyFromPriorYear.mockResolvedValue(null);

    const res = await request(createApp())
      .post(`/api/farms/${FARM_ID}/labour/plan/copy-from-prior`)
      .send({ fiscal_year: 2026 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/FY2025/);
  });
});

// ─── General routes (cross-farm) ────────────────────────────────────

describe('POST /api/labour/bulk-status', () => {
  it('updates status for all plans', async () => {
    // Admin check
    prismaMock.userFarmRole.findFirst.mockResolvedValue({ role: 'admin' });
    mockSvc.bulkUpdatePlanStatus.mockResolvedValue({ updated: 3, status: 'locked' });

    const res = await request(createApp())
      .post('/api/labour/bulk-status')
      .send({ fiscal_year: 2026, status: 'locked' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(3);
  });

  it('rejects invalid status', async () => {
    const res = await request(createApp())
      .post('/api/labour/bulk-status')
      .send({ fiscal_year: 2026, status: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('rejects missing fiscal_year', async () => {
    const res = await request(createApp())
      .post('/api/labour/bulk-status')
      .send({ status: 'locked' });

    expect(res.status).toBe(400);
  });

  it('rejects non-admin users', async () => {
    prismaMock.userFarmRole.findFirst.mockResolvedValue(null);

    const res = await request(createApp())
      .post('/api/labour/bulk-status')
      .send({ fiscal_year: 2026, status: 'locked' });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/labour/bulk-push', () => {
  it('pushes all plans to forecast', async () => {
    prismaMock.userFarmRole.findFirst.mockResolvedValue({ role: 'admin' });
    mockSvc.bulkPushToForecast.mockResolvedValue({ total: 7, pushed: 7 });

    const res = await request(createApp())
      .post('/api/labour/bulk-push')
      .send({ fiscal_year: 2026 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(7);
    expect(res.body.pushed).toBe(7);
  });

  it('rejects missing fiscal_year', async () => {
    const res = await request(createApp())
      .post('/api/labour/bulk-push')
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects non-admin users', async () => {
    prismaMock.userFarmRole.findFirst.mockResolvedValue(null);

    const res = await request(createApp())
      .post('/api/labour/bulk-push')
      .send({ fiscal_year: 2026 });

    expect(res.status).toBe(403);
  });
});
