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
}));

vi.mock('../services/calculationService.js', () => ({
  updatePerUnitCell: vi.fn(async () => ({
    perUnit: { rev_canola: 10 },
    accounting: { rev_canola: 50000 },
  })),
  updateAccountingCell: vi.fn(async () => ({
    perUnit: { rev_canola: 1 },
    accounting: { rev_canola: 5000 },
  })),
}));

vi.mock('../services/categoryService.js', () => ({
  getFarmCategories: vi.fn(() => []),
  getFarmLeafCategories: vi.fn(() => [
    { code: 'rev_canola' },
    { code: 'input_seed' },
  ]),
  recalcParentSums: vi.fn((data) => data),
}));

vi.mock('../services/forecastService.js', () => ({
  calculateForecast: vi.fn(() => ({})),
}));

vi.mock('../socket/handler.js', () => ({
  broadcastCellChange: vi.fn(),
}));

const { default: financialRoutes } = await import('./financial.js');
const { authenticate, requireFarmAccess } = await import('../middleware/auth.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/farms/:farmId', authenticate, requireFarmAccess);
  app.use('/api/farms', financialRoutes);
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  });
  return app;
}

const FARM_ID = 'farm-1';

describe('PATCH /api/farms/:farmId/accounting/:year/:month', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('rejects edit on actual month — 403', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue({
      farm_id: FARM_ID,
      fiscal_year: 2025,
      is_frozen: false,
    });
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      is_actual: true,
    });

    const res = await request(app)
      .patch(`/api/farms/${FARM_ID}/accounting/2025/Jan`)
      .send({ category_code: 'rev_canola', value: 1000 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/actual/i);
  });

  it('rejects edit when budget is frozen — 403', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue({
      farm_id: FARM_ID,
      fiscal_year: 2025,
      is_frozen: true,
    });
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      is_actual: false,
    });

    const res = await request(app)
      .patch(`/api/farms/${FARM_ID}/accounting/2025/Jan`)
      .send({ category_code: 'rev_canola', value: 1000 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/frozen/i);
  });

  it('allows edit on non-frozen, non-actual month', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue({
      farm_id: FARM_ID,
      fiscal_year: 2025,
      is_frozen: false,
    });
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      is_actual: false,
    });

    const res = await request(app)
      .patch(`/api/farms/${FARM_ID}/accounting/2025/Jan`)
      .send({ category_code: 'rev_canola', value: 1000 });

    expect(res.status).toBe(200);
  });

  it('rejects invalid fiscal year — 400', async () => {
    const res = await request(app)
      .patch(`/api/farms/${FARM_ID}/accounting/abc/Jan`)
      .send({ category_code: 'rev_canola', value: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fiscal year/i);
  });

  it('rejects invalid month — 400', async () => {
    const res = await request(app)
      .patch(`/api/farms/${FARM_ID}/accounting/2025/Foo`)
      .send({ category_code: 'rev_canola', value: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/month/i);
  });

  it('rejects missing category_code — 400', async () => {
    const res = await request(app)
      .patch(`/api/farms/${FARM_ID}/accounting/2025/Jan`)
      .send({ value: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('rejects parent category edit — 400', async () => {
    const res = await request(app)
      .patch(`/api/farms/${FARM_ID}/accounting/2025/Jan`)
      .send({ category_code: 'revenue', value: 1000 }); // 'revenue' is not in leaf list

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parent/i);
  });
});

describe('PATCH /api/farms/:farmId/per-unit/:year/:month', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('rejects edit on actual month — 403', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue({
      farm_id: FARM_ID,
      fiscal_year: 2025,
      is_frozen: false,
    });
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      is_actual: true,
    });

    const res = await request(app)
      .patch(`/api/farms/${FARM_ID}/per-unit/2025/Jan`)
      .send({ category_code: 'rev_canola', value: 10 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/actual/i);
  });

  it('rejects edit when budget is frozen — 403', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue({
      farm_id: FARM_ID,
      fiscal_year: 2025,
      is_frozen: true,
    });
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      is_actual: false,
    });

    const res = await request(app)
      .patch(`/api/farms/${FARM_ID}/per-unit/2025/Jan`)
      .send({ category_code: 'rev_canola', value: 10 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/frozen/i);
  });

  it('allows edit on non-frozen, non-actual month', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue({
      farm_id: FARM_ID,
      fiscal_year: 2025,
      is_frozen: false,
    });
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      is_actual: false,
    });

    const res = await request(app)
      .patch(`/api/farms/${FARM_ID}/per-unit/2025/Jan`)
      .send({ category_code: 'rev_canola', value: 10 });

    expect(res.status).toBe(200);
  });
});
