import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock } from '../__mocks__/prismaClient.js';

const prismaMock = createPrismaMock();

vi.mock('../config/database.js', () => ({ default: prismaMock }));

vi.mock('./categoryService.js', () => ({
  getFarmCategories: vi.fn(() => [
    { id: '1', code: 'inputs', parent_id: null, level: 0 },
    { id: '2', code: 'input_seed', parent_id: '1', level: 1 },
    { id: '3', code: 'input_fert', parent_id: '1', level: 1 },
  ]),
  recalcParentSums: vi.fn((data) => {
    const result = { ...data };
    result.inputs = (result.input_seed || 0) + (result.input_fert || 0);
    return result;
  }),
}));

const { rollupGlActuals } = await import('./glRollupService.js');

const FARM_ID = 'farm-1';
const FY = 2025;
const MONTH = 'Jan';

beforeEach(() => {
  vi.clearAllMocks();

  prismaMock.assumption.findUnique.mockResolvedValue({
    farm_id: FARM_ID,
    fiscal_year: FY,
    total_acres: 1000,
  });
});

describe('rollupGlActuals', () => {
  it('sums GL actuals by category code', async () => {
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 100, gl_account: { category: { code: 'input_seed' } } },
      { amount: 200, gl_account: { category: { code: 'input_seed' } } },
      { amount: 50, gl_account: { category: { code: 'input_fert' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    expect(result.accounting.input_seed).toBe(300);
    expect(result.accounting.input_fert).toBe(50);
    expect(result.accounting.inputs).toBe(350);
  });

  it('skips unmapped GL accounts', async () => {
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 100, gl_account: { category: { code: 'input_seed' } } },
      { amount: 999, gl_account: { category: null } }, // unmapped
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    expect(result.accounting.input_seed).toBe(100);
    // 999 should be nowhere
    expect(Object.values(result.accounting)).not.toContain(999);
  });

  it('marks records as is_actual: true', async () => {
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 100, gl_account: { category: { code: 'input_seed' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    await rollupGlActuals(FARM_ID, FY, MONTH);

    // Both accounting and per_unit upserts should set is_actual: true
    const accountingUpsert = prismaMock.monthlyData.upsert.mock.calls[0][0];
    expect(accountingUpsert.update.is_actual).toBe(true);
    expect(accountingUpsert.create.is_actual).toBe(true);

    const perUnitUpsert = prismaMock.monthlyData.upsert.mock.calls[1][0];
    expect(perUnitUpsert.update.is_actual).toBe(true);
    expect(perUnitUpsert.create.is_actual).toBe(true);
  });

  it('cascades to per-unit using total acres', async () => {
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 5000, gl_account: { category: { code: 'input_seed' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    // 5000 / 1000 acres = 5.0
    expect(result.perUnit.input_seed).toBe(5);
  });

  it('falls back to 1 acre when assumption missing', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue(null);
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 500, gl_account: { category: { code: 'input_seed' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    // Fallback: totalAcres || 1, so 500 / 1 = 500
    expect(result.perUnit.input_seed).toBe(500);
  });

  it('merges with existing manual data', async () => {
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 100, gl_account: { category: { code: 'input_seed' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: { input_fert: 200 }, // manually entered
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    // GL data overwrites input_seed, manual input_fert preserved
    expect(result.accounting.input_seed).toBe(100);
    expect(result.accounting.input_fert).toBe(200);
  });
});
