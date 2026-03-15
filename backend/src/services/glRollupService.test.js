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

const { rollupGlActuals, importGlActuals } = await import('./glRollupService.js');

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

  it('returns zero per-unit when assumption missing', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue(null);
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 500, gl_account: { category: { code: 'input_seed' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    expect(result.perUnit.input_seed).toBe(0);
  });

  it('zeroes leaf categories without GL data during rollup', async () => {
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 100, gl_account: { category: { code: 'input_seed' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: { input_fert: 200 }, // previously entered, but no GL data now
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    // GL data sets input_seed; input_fert zeroed (no GL source)
    expect(result.accounting.input_seed).toBe(100);
    expect(result.accounting.input_fert).toBe(0);
  });

  it('handles zero acres in per-unit cascade', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue({
      farm_id: FARM_ID,
      fiscal_year: FY,
      total_acres: 0,
    });
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 500, gl_account: { category: { code: 'input_seed' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    // Should be 0, not Infinity or NaN
    expect(result.perUnit.input_seed).toBe(0);
    expect(result.accounting.input_seed).toBe(500);
  });

  it('handles empty GL actuals (no transactions for month)', async () => {
    prismaMock.glActualDetail.findMany.mockResolvedValue([]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    // All leaves should be zero
    expect(result.accounting.input_seed).toBe(0);
    expect(result.accounting.input_fert).toBe(0);
    expect(result.accounting.inputs).toBe(0);
  });

  it('handles negative GL amounts (credits/refunds)', async () => {
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 1000, gl_account: { category: { code: 'input_seed' } } },
      { amount: -200, gl_account: { category: { code: 'input_seed' } } }, // refund
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    expect(result.accounting.input_seed).toBe(800); // 1000 - 200
    expect(result.perUnit.input_seed).toBe(0.8); // 800 / 1000
  });

  it('sums multiple GL accounts mapped to same category', async () => {
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 300, gl_account: { category: { code: 'input_fert' } } }, // account 5100
      { amount: 150, gl_account: { category: { code: 'input_fert' } } }, // account 5110
      { amount: 75, gl_account: { category: { code: 'input_fert' } } },  // account 5120
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    expect(result.accounting.input_fert).toBe(525);
  });

  it('accounting upsert uses correct composite key', async () => {
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 100, gl_account: { category: { code: 'input_seed' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    await rollupGlActuals(FARM_ID, FY, MONTH);

    const accountingUpsert = prismaMock.monthlyData.upsert.mock.calls[0][0];
    expect(accountingUpsert.where.farm_id_fiscal_year_month_type).toEqual({
      farm_id: FARM_ID,
      fiscal_year: FY,
      month: MONTH,
      type: 'accounting',
    });

    const perUnitUpsert = prismaMock.monthlyData.upsert.mock.calls[1][0];
    expect(perUnitUpsert.where.farm_id_fiscal_year_month_type).toEqual({
      farm_id: FARM_ID,
      fiscal_year: FY,
      month: MONTH,
      type: 'per_unit',
    });
  });

  it('preserves parent sums in per-unit layer', async () => {
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 3000, gl_account: { category: { code: 'input_seed' } } },
      { amount: 7000, gl_account: { category: { code: 'input_fert' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await rollupGlActuals(FARM_ID, FY, MONTH);

    expect(result.perUnit.inputs).toBe(10); // (3000 + 7000) / 1000
    expect(result.perUnit.input_seed).toBe(3); // 3000 / 1000
    expect(result.perUnit.input_fert).toBe(7); // 7000 / 1000
  });
});

describe('importGlActuals', () => {
  it('skips rows with unknown GL account numbers', async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => {
      const tx = {
        glAccount: {
          findUnique: vi.fn()
            .mockResolvedValueOnce(null) // unknown account
            .mockResolvedValueOnce({ id: 'gl-1' }), // known account
        },
        glActualDetail: {
          upsert: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    // Mock rollupGlActuals dependency
    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 200, gl_account: { category: { code: 'input_seed' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await importGlActuals(FARM_ID, FY, [
      { account_number: '9999', month: 'Jan', amount: 100 }, // unknown
      { account_number: '5000', month: 'Jan', amount: 200 }, // known
    ]);

    // Only Jan should be rolled up (the unknown account's month is still Jan)
    expect(result.monthsImported).toBe(1);
  });

  it('rolls up multiple affected months independently', async () => {
    prismaMock.$transaction.mockImplementation(async (fn) => {
      const tx = {
        glAccount: {
          findUnique: vi.fn().mockResolvedValue({ id: 'gl-1' }),
        },
        glActualDetail: {
          upsert: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    prismaMock.glActualDetail.findMany.mockResolvedValue([
      { amount: 100, gl_account: { category: { code: 'input_seed' } } },
    ]);
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await importGlActuals(FARM_ID, FY, [
      { account_number: '5000', month: 'Jan', amount: 100 },
      { account_number: '5000', month: 'Feb', amount: 200 },
      { account_number: '5100', month: 'Jan', amount: 50 },
    ]);

    // Two distinct months affected
    expect(result.monthsImported).toBe(2);
    expect(result.results).toHaveProperty('Jan');
    expect(result.results).toHaveProperty('Feb');
  });
});
