import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock } from '../__mocks__/prismaClient.js';

const prismaMock = createPrismaMock();

vi.mock('../config/database.js', () => ({ default: prismaMock }));
const mockUpdatePerUnitCell = vi.fn(async () => ({}));
vi.mock('./calculationService.js', () => ({
  updatePerUnitCell: mockUpdatePerUnitCell,
}));

const svc = await import('./labourService.js');

const FARM_ID = 'farm-1';
const FY = 2026;

// ─── Helper factories ──────────────────────────────────────────────

function makePlan(overrides = {}) {
  return {
    id: 'plan-1',
    farm_id: FARM_ID,
    fiscal_year: FY,
    avg_wage: 32,
    total_acres: 10000,
    status: 'draft',
    seasons: [
      {
        id: 's1', name: 'Seeding', sort_order: 1, months: ['May'],
        roles: [
          { id: 'r1', name: 'Seeders', hours: 500, sort_order: 1 },
          { id: 'r2', name: 'Truckers', hours: 300, sort_order: 2 },
        ],
      },
      {
        id: 's2', name: 'Harvest', sort_order: 2, months: ['Sep', 'Oct'],
        roles: [
          { id: 'r3', name: 'Combines', hours: 600, sort_order: 1 },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default mocks for acre resolution and season reorder (used by getPlan/getPlanById)
  prismaMock.assumption.findUnique.mockResolvedValue({ total_acres: 10000 });
  prismaMock.labourSeason.update.mockResolvedValue({});
  prismaMock.labourPlan.update.mockResolvedValue({});
});

// ─── getPlan ────────────────────────────────────────────────────────

describe('getPlan', () => {
  it('returns plan with seasons and roles', async () => {
    const plan = makePlan();
    prismaMock.labourPlan.findUnique.mockResolvedValue(plan);

    const result = await svc.getPlan(FARM_ID, FY);

    expect(result.id).toBe('plan-1');
    expect(result.seasons).toHaveLength(2);
    expect(prismaMock.labourPlan.findUnique).toHaveBeenCalledWith({
      where: { farm_id_fiscal_year: { farm_id: FARM_ID, fiscal_year: FY } },
      include: expect.objectContaining({
        seasons: expect.any(Object),
      }),
    });
  });

  it('returns null when no plan exists', async () => {
    prismaMock.labourPlan.findUnique.mockResolvedValue(null);
    const result = await svc.getPlan(FARM_ID, FY);
    expect(result).toBeNull();
  });
});

// ─── createPlan ─────────────────────────────────────────────────────

describe('createPlan', () => {
  it('creates plan with default seasons and pulls acres from assumptions', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue({ total_acres: 15000 });
    const created = makePlan({ total_acres: 15000 });
    prismaMock.labourPlan.create.mockResolvedValue(created);

    const result = await svc.createPlan(FARM_ID, FY, 32);

    expect(prismaMock.labourPlan.create).toHaveBeenCalledTimes(1);
    const createArg = prismaMock.labourPlan.create.mock.calls[0][0];
    expect(createArg.data.farm_id).toBe(FARM_ID);
    expect(createArg.data.fiscal_year).toBe(FY);
    expect(createArg.data.avg_wage).toBe(32);
    expect(createArg.data.total_acres).toBe(15000);
    expect(createArg.data.seasons.create).toHaveLength(5); // 5 default seasons
    expect(result).toEqual(created);
  });

  it('defaults to 0 acres when no assumption exists', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue(null);
    prismaMock.labourPlan.create.mockResolvedValue(makePlan({ total_acres: 0 }));

    await svc.createPlan(FARM_ID, FY);

    const createArg = prismaMock.labourPlan.create.mock.calls[0][0];
    expect(createArg.data.total_acres).toBe(0);
  });

  it('defaults avg_wage to 32 when not provided', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue(null);
    prismaMock.labourPlan.create.mockResolvedValue(makePlan());

    await svc.createPlan(FARM_ID, FY);

    const createArg = prismaMock.labourPlan.create.mock.calls[0][0];
    expect(createArg.data.avg_wage).toBe(32);
  });
});

// ─── updatePlan ─────────────────────────────────────────────────────

describe('updatePlan', () => {
  it('updates only provided fields', async () => {
    prismaMock.labourPlan.update.mockResolvedValue(makePlan({ avg_wage: 35 }));

    await svc.updatePlan('plan-1', { avg_wage: 35 });

    const updateArg = prismaMock.labourPlan.update.mock.calls[0][0];
    expect(updateArg.data).toEqual({ avg_wage: 35 });
    expect(updateArg.data).not.toHaveProperty('status');
    expect(updateArg.data).not.toHaveProperty('notes');
  });

  it('updates status', async () => {
    prismaMock.labourPlan.update.mockResolvedValue(makePlan({ status: 'locked' }));

    const result = await svc.updatePlan('plan-1', { status: 'locked' });

    expect(result.status).toBe('locked');
  });

  it('updates multiple fields at once', async () => {
    prismaMock.labourPlan.update.mockResolvedValue(makePlan());

    await svc.updatePlan('plan-1', { avg_wage: 35, total_acres: 12000, notes: 'test' });

    const updateArg = prismaMock.labourPlan.update.mock.calls[0][0];
    expect(updateArg.data).toEqual({ avg_wage: 35, total_acres: 12000, notes: 'test' });
  });
});

// ─── bulkUpdateSeasons ──────────────────────────────────────────────

describe('bulkUpdateSeasons', () => {
  it('deletes existing seasons and recreates', async () => {
    prismaMock.labourSeason.deleteMany.mockResolvedValue({});
    prismaMock.labourSeason.create.mockResolvedValue({});
    prismaMock.labourPlan.findUnique.mockResolvedValue(makePlan());

    const seasons = [
      { name: 'Seeding', sort_order: 1, months: ['May'], roles: [{ name: 'Seeders', hours: 100 }] },
      { name: 'Harvest', sort_order: 2, months: ['Sep'], roles: [] },
    ];
    await svc.bulkUpdateSeasons('plan-1', seasons);

    expect(prismaMock.labourSeason.deleteMany).toHaveBeenCalledWith({ where: { plan_id: 'plan-1' } });
    expect(prismaMock.labourSeason.create).toHaveBeenCalledTimes(2);
  });

  it('handles empty seasons array', async () => {
    prismaMock.labourSeason.deleteMany.mockResolvedValue({});
    prismaMock.labourPlan.findUnique.mockResolvedValue(makePlan({ seasons: [] }));

    await svc.bulkUpdateSeasons('plan-1', []);

    expect(prismaMock.labourSeason.deleteMany).toHaveBeenCalled();
    expect(prismaMock.labourSeason.create).not.toHaveBeenCalled();
  });

  it('defaults role hours to 0 when missing', async () => {
    prismaMock.labourSeason.deleteMany.mockResolvedValue({});
    prismaMock.labourSeason.create.mockResolvedValue({});
    prismaMock.labourPlan.findUnique.mockResolvedValue(makePlan());

    await svc.bulkUpdateSeasons('plan-1', [
      { name: 'Test', sort_order: 1, months: ['May'], roles: [{ name: 'Role1' }] },
    ]);

    const createArg = prismaMock.labourSeason.create.mock.calls[0][0];
    expect(createArg.data.roles.create[0].hours).toBe(0);
  });
});

// ─── pushToForecast ─────────────────────────────────────────────────

describe('pushToForecast', () => {
  it('pushes monthly labour costs to forecast', async () => {
    const plan = makePlan();
    prismaMock.labourPlan.findUnique.mockResolvedValue(plan);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null); // no actuals

    const result = await svc.pushToForecast('plan-1');

    expect(result.pushed).toBe(true);
    // Seeding (May): 800 hrs, Harvest (Sep, Oct): 600 hrs / 2 months = 300/month
    // May: 800 hrs, Sep: 300 hrs, Oct: 300 hrs
    expect(result.monthsUpdated).toContain('May');
    expect(result.monthsUpdated).toContain('Sep');
    expect(result.monthsUpdated).toContain('Oct');
    expect(mockUpdatePerUnitCell).toHaveBeenCalled();
  });

  it('pushes to all months including those with actuals (Two-Books: plan always writable)', async () => {
    const plan = makePlan();
    prismaMock.labourPlan.findUnique.mockResolvedValue(plan);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);

    const result = await svc.pushToForecast('plan-1');

    expect(result.pushed).toBe(true);
    // All months with hours should be updated (May from Seeding, Sep+Oct from Harvest)
    expect(result.monthsUpdated).toContain('May');
    expect(result.monthsUpdated).toContain('Sep');
    expect(result.monthsUpdated).toContain('Oct');
  });

  it('returns not pushed when no total acres', async () => {
    prismaMock.labourPlan.findUnique.mockResolvedValue(makePlan({ total_acres: 0 }));
    prismaMock.assumption.findUnique.mockResolvedValue({ total_acres: 0 });

    const result = await svc.pushToForecast('plan-1');

    expect(result.pushed).toBe(false);
    expect(result.reason).toMatch(/acres/i);
  });

  it('throws when plan not found', async () => {
    prismaMock.labourPlan.findUnique.mockResolvedValue(null);

    await expect(svc.pushToForecast('missing')).rejects.toThrow(/not found/i);
  });

  it('skips seasons with zero hours', async () => {
    const plan = makePlan({
      seasons: [
        { id: 's1', name: 'Empty', sort_order: 1, months: ['May'], roles: [{ hours: 0 }] },
        { id: 's2', name: 'Active', sort_order: 2, months: ['Sep'], roles: [{ hours: 200 }] },
      ],
    });
    prismaMock.labourPlan.findUnique.mockResolvedValue(plan);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);

    const result = await svc.pushToForecast('plan-1');

    expect(result.monthsUpdated).not.toContain('May');
    expect(result.monthsUpdated).toContain('Sep');
  });
});

// ─── bulkUpdatePlanStatus ───────────────────────────────────────────

describe('bulkUpdatePlanStatus', () => {
  it('updates all plans for a fiscal year', async () => {
    prismaMock.labourPlan.findMany.mockResolvedValue([
      { id: 'p1', farm_id: 'f1', status: 'draft' },
      { id: 'p2', farm_id: 'f2', status: 'draft' },
    ]);
    prismaMock.labourPlan.update.mockResolvedValue({});

    const result = await svc.bulkUpdatePlanStatus(FY, 'locked');

    expect(prismaMock.labourPlan.update).toHaveBeenCalledTimes(2);
    expect(result.updated).toBe(2);
    expect(result.status).toBe('locked');
    expect(result.details).toHaveLength(2);
    expect(result.details[0].old_status).toBe('draft');
    expect(result.details[0].new_status).toBe('locked');
  });

  it('returns zero when no plans exist', async () => {
    prismaMock.labourPlan.findMany.mockResolvedValue([]);

    const result = await svc.bulkUpdatePlanStatus(FY, 'locked');

    expect(result.updated).toBe(0);
    expect(prismaMock.labourPlan.update).not.toHaveBeenCalled();
  });
});

// ─── bulkPushToForecast ─────────────────────────────────────────────

describe('bulkPushToForecast', () => {
  it('pushes all plans for a fiscal year', async () => {
    prismaMock.labourPlan.findMany.mockResolvedValue([
      { id: 'p1', farm_id: 'f1' },
      { id: 'p2', farm_id: 'f2' },
    ]);
    // Each pushToForecast calls findUnique for the plan
    const plan1 = makePlan({ id: 'p1', farm_id: 'f1' });
    const plan2 = makePlan({ id: 'p2', farm_id: 'f2' });
    prismaMock.labourPlan.findUnique
      .mockResolvedValueOnce(plan1)
      .mockResolvedValueOnce(plan2);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);

    const result = await svc.bulkPushToForecast(FY);

    expect(result.total).toBe(2);
    expect(result.pushed).toBe(2);
    expect(result.details).toHaveLength(2);
  });

  it('handles individual push failures gracefully', async () => {
    prismaMock.labourPlan.findMany.mockResolvedValue([
      { id: 'p1', farm_id: 'f1' },
      { id: 'p2', farm_id: 'f2' },
    ]);
    // First plan found, second plan not found (pushToForecast throws)
    prismaMock.labourPlan.findUnique
      .mockResolvedValueOnce(makePlan({ id: 'p1' }))
      .mockResolvedValueOnce(null);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);

    const result = await svc.bulkPushToForecast(FY);

    expect(result.total).toBe(2);
    expect(result.pushed).toBe(1);
    expect(result.details[1].pushed).toBe(false);
    expect(result.details[1].reason).toMatch(/not found/i);
  });
});

// ─── copyFromPriorYear ──────────────────────────────────────────────

describe('copyFromPriorYear', () => {
  it('copies seasons and roles from prior year', async () => {
    const source = makePlan({ fiscal_year: FY - 1 });
    prismaMock.labourPlan.findUnique.mockResolvedValue(source);
    prismaMock.assumption.findUnique.mockResolvedValue({ total_acres: 12000 });
    const created = makePlan({ fiscal_year: FY, total_acres: 12000 });
    prismaMock.labourPlan.create.mockResolvedValue(created);

    const result = await svc.copyFromPriorYear(FARM_ID, FY);

    expect(result.fiscal_year).toBe(FY);
    const createArg = prismaMock.labourPlan.create.mock.calls[0][0];
    expect(createArg.data.fiscal_year).toBe(FY);
    expect(createArg.data.avg_wage).toBe(source.avg_wage);
    expect(createArg.data.total_acres).toBe(12000);
    expect(createArg.data.seasons.create).toHaveLength(source.seasons.length);
    // Verify roles are cloned
    expect(createArg.data.seasons.create[0].roles.create).toHaveLength(2);
    expect(createArg.data.seasons.create[0].roles.create[0].name).toBe('Seeders');
    expect(createArg.data.seasons.create[0].roles.create[0].hours).toBe(500);
  });

  it('returns null when no prior year plan exists', async () => {
    prismaMock.labourPlan.findUnique.mockResolvedValue(null);

    const result = await svc.copyFromPriorYear(FARM_ID, FY);

    expect(result).toBeNull();
    expect(prismaMock.labourPlan.create).not.toHaveBeenCalled();
  });

  it('uses source plan acres when no target assumption exists', async () => {
    const source = makePlan({ fiscal_year: FY - 1, total_acres: 8000 });
    prismaMock.labourPlan.findUnique.mockResolvedValue(source);
    prismaMock.assumption.findUnique.mockResolvedValue(null);
    prismaMock.labourPlan.create.mockResolvedValue(makePlan());

    await svc.copyFromPriorYear(FARM_ID, FY);

    const createArg = prismaMock.labourPlan.create.mock.calls[0][0];
    expect(createArg.data.total_acres).toBe(8000);
  });
});

// ─── getDashboard ───────────────────────────────────────────────────

describe('getDashboard', () => {
  it('computes correct totals', async () => {
    prismaMock.labourPlan.findUnique.mockResolvedValue(makePlan());

    const result = await svc.getDashboard(FARM_ID, FY);

    // Seeding: 500+300=800, Harvest: 600, Total: 1400 hrs
    expect(result.total_hours).toBe(1400);
    expect(result.total_cost).toBe(1400 * 32); // 44800
    expect(result.cost_per_acre).toBeCloseTo(44800 / 10000);
    expect(result.hours_per_acre).toBeCloseTo(1400 / 10000);
    expect(result.seasons).toHaveLength(2);
    expect(result.seasons[0].name).toBe('Seeding');
    expect(result.seasons[0].hours).toBe(800);
  });

  it('returns null when no plan exists', async () => {
    prismaMock.labourPlan.findUnique.mockResolvedValue(null);

    const result = await svc.getDashboard(FARM_ID, FY);

    expect(result).toBeNull();
  });

  it('handles zero acres without division error', async () => {
    prismaMock.labourPlan.findUnique.mockResolvedValue(makePlan({ total_acres: 0 }));
    prismaMock.assumption.findUnique.mockResolvedValue({ total_acres: 0 });

    const result = await svc.getDashboard(FARM_ID, FY);

    expect(result.cost_per_acre).toBe(0);
    expect(result.hours_per_acre).toBe(0);
  });
});
