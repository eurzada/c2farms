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

vi.mock('../services/categoryService.js', () => ({
  getFarmCategories: vi.fn(() => []),
  initFarmCategories: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../services/glRollupService.js', () => ({
  importGlActuals: vi.fn(async () => ({ monthsImported: 0, results: {} })),
}));

const { default: chartOfAccountsRoutes } = await import('./chartOfAccounts.js');
const { authenticate, requireFarmAccess } = await import('../middleware/auth.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/farms/:farmId', authenticate, requireFarmAccess);
  app.use('/api/farms', chartOfAccountsRoutes);
  app.use((err, _req, res, _next) => {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Category code already exists for this farm' });
    }
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  });
  return app;
}

const FARM_ID = 'farm-1';
const OTHER_FARM = 'farm-2';

describe('PUT /api/farms/:farmId/categories/:id — ownership', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('rejects update when category belongs to different farm', async () => {
    prismaMock.farmCategory.findUnique.mockResolvedValue({
      id: 'cat-1',
      farm_id: OTHER_FARM, // different farm!
      code: 'revenue',
    });

    const res = await request(app)
      .put(`/api/farms/${FARM_ID}/categories/cat-1`)
      .send({ display_name: 'Hacked Revenue' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    // Prisma update should NOT have been called
    expect(prismaMock.farmCategory.update).not.toHaveBeenCalled();
  });

  it('allows update when category belongs to same farm', async () => {
    prismaMock.farmCategory.findUnique.mockResolvedValue({
      id: 'cat-1',
      farm_id: FARM_ID,
      code: 'revenue',
    });
    prismaMock.farmCategory.update.mockResolvedValue({
      id: 'cat-1',
      display_name: 'Updated Revenue',
    });

    const res = await request(app)
      .put(`/api/farms/${FARM_ID}/categories/cat-1`)
      .send({ display_name: 'Updated Revenue' });

    expect(res.status).toBe(200);
    expect(prismaMock.farmCategory.update).toHaveBeenCalled();
  });

  it('returns 404 when category does not exist', async () => {
    prismaMock.farmCategory.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put(`/api/farms/${FARM_ID}/categories/nonexistent`)
      .send({ display_name: 'Test' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/farms/:farmId/categories/:id — ownership', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('rejects delete when category belongs to different farm', async () => {
    prismaMock.farmCategory.findUnique.mockResolvedValue({
      id: 'cat-1',
      farm_id: OTHER_FARM,
    });

    const res = await request(app)
      .delete(`/api/farms/${FARM_ID}/categories/cat-1`);

    expect(res.status).toBe(404);
    expect(prismaMock.farmCategory.update).not.toHaveBeenCalled();
  });
});

describe('PUT /api/farms/:farmId/gl-accounts/:id — ownership', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('rejects update when GL account belongs to different farm', async () => {
    prismaMock.glAccount.findUnique.mockResolvedValue({
      id: 'gl-1',
      farm_id: OTHER_FARM,
    });

    const res = await request(app)
      .put(`/api/farms/${FARM_ID}/gl-accounts/gl-1`)
      .send({ account_name: 'Hacked Account' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(prismaMock.glAccount.update).not.toHaveBeenCalled();
  });

  it('allows update when GL account belongs to same farm', async () => {
    prismaMock.glAccount.findUnique.mockResolvedValueOnce({
      id: 'gl-1',
      farm_id: FARM_ID,
    });
    // For category_code resolution
    prismaMock.farmCategory.findUnique.mockResolvedValue({
      id: 'cat-1',
      code: 'input_seed',
    });
    prismaMock.glAccount.update.mockResolvedValue({ id: 'gl-1' });

    const res = await request(app)
      .put(`/api/farms/${FARM_ID}/gl-accounts/gl-1`)
      .send({ account_name: 'Updated', category_code: 'input_seed' });

    expect(res.status).toBe(200);
    expect(prismaMock.glAccount.update).toHaveBeenCalled();
  });
});

describe('POST /api/farms/:farmId/gl-accounts/bulk-assign', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('sets category_id to null when category_code is empty', async () => {
    prismaMock.glAccount.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post(`/api/farms/${FARM_ID}/gl-accounts/bulk-assign`)
      .send({
        assignments: [
          { account_number: '9660', category_code: '' }, // empty = unmap
        ],
      });

    expect(res.status).toBe(200);
    expect(prismaMock.glAccount.updateMany).toHaveBeenCalledWith({
      where: { farm_id: FARM_ID, account_number: '9660' },
      data: { category_id: null },
    });
  });

  it('sets category_id to null when category_code is null', async () => {
    prismaMock.glAccount.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post(`/api/farms/${FARM_ID}/gl-accounts/bulk-assign`)
      .send({
        assignments: [
          { account_number: '9660', category_code: null },
        ],
      });

    expect(res.status).toBe(200);
    expect(prismaMock.glAccount.updateMany).toHaveBeenCalledWith({
      where: { farm_id: FARM_ID, account_number: '9660' },
      data: { category_id: null },
    });
  });

  it('maps valid category_code to category_id', async () => {
    prismaMock.farmCategory.findUnique.mockResolvedValue({
      id: 'cat-1',
      code: 'input_seed',
    });
    prismaMock.glAccount.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post(`/api/farms/${FARM_ID}/gl-accounts/bulk-assign`)
      .send({
        assignments: [
          { account_number: '9660', category_code: 'input_seed' },
        ],
      });

    expect(res.status).toBe(200);
    expect(prismaMock.glAccount.updateMany).toHaveBeenCalledWith({
      where: { farm_id: FARM_ID, account_number: '9660' },
      data: { category_id: 'cat-1' },
    });
  });

  it('skips assignment when category_code not found', async () => {
    prismaMock.farmCategory.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/farms/${FARM_ID}/gl-accounts/bulk-assign`)
      .send({
        assignments: [
          { account_number: '9660', category_code: 'nonexistent' },
        ],
      });

    expect(res.status).toBe(200);
    // updateMany should NOT be called because category was not found → continue
    expect(prismaMock.glAccount.updateMany).not.toHaveBeenCalled();
  });

  it('rejects missing assignments array — 400', async () => {
    const res = await request(app)
      .post(`/api/farms/${FARM_ID}/gl-accounts/bulk-assign`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/assignments/i);
  });

  it('handles multiple assignments', async () => {
    prismaMock.farmCategory.findUnique.mockResolvedValue({ id: 'cat-1' });
    prismaMock.glAccount.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post(`/api/farms/${FARM_ID}/gl-accounts/bulk-assign`)
      .send({
        assignments: [
          { account_number: '9660', category_code: 'input_seed' },
          { account_number: '9662', category_code: '' }, // unmap
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('2');
  });
});

describe('POST /api/farms/:farmId/categories', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('rejects missing required fields — 400', async () => {
    const res = await request(app)
      .post(`/api/farms/${FARM_ID}/categories`)
      .send({ code: 'test' }); // missing display_name and category_type

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('creates category successfully', async () => {
    prismaMock.farmCategory.create.mockResolvedValue({
      id: 'cat-new',
      code: 'test_cat',
      display_name: 'Test Category',
    });

    const res = await request(app)
      .post(`/api/farms/${FARM_ID}/categories`)
      .send({
        code: 'test_cat',
        display_name: 'Test Category',
        category_type: 'INPUT',
      });

    expect(res.status).toBe(201);
  });

  it('returns 409 on duplicate code', async () => {
    prismaMock.farmCategory.create.mockRejectedValue({ code: 'P2002' });

    const res = await request(app)
      .post(`/api/farms/${FARM_ID}/categories`)
      .send({
        code: 'duplicate',
        display_name: 'Duplicate',
        category_type: 'INPUT',
      });

    expect(res.status).toBe(409);
  });
});
