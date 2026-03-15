import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrismaMock } from '../__mocks__/prismaClient.js';

const prismaMock = createPrismaMock();

vi.mock('../config/database.js', () => ({ default: prismaMock }));

// Mock categoryService to avoid its own Prisma dependency
vi.mock('./categoryService.js', () => ({
  validateLeafCategory: vi.fn(),
  getFarmCategories: vi.fn(() => [
    { id: '1', code: 'revenue', parent_id: null, level: 0 },
    { id: '2', code: 'rev_canola', parent_id: '1', level: 1 },
    { id: '3', code: 'rev_other_income', parent_id: '1', level: 1 },
    { id: '5', code: 'inputs', parent_id: null, level: 0 },
    { id: '6', code: 'input_seed', parent_id: '5', level: 1 },
  ]),
  recalcParentSums: vi.fn((data, _cats) => {
    // Simple pass-through for testing — just return input with parent sums faked
    const result = { ...data };
    if ('rev_canola' in result || 'rev_other_income' in result) {
      result.revenue = (result.rev_canola || 0) + (result.rev_other_income || 0);
    }
    if ('input_seed' in result) {
      result.inputs = result.input_seed || 0;
    }
    return result;
  }),
}));

const { updateAccountingCell, updatePerUnitCell } = await import('./calculationService.js');

const FARM_ID = 'farm-1';
const FY = 2025;
const MONTH = 'Jan';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: assumption exists with 5000 acres
  prismaMock.assumption.findUnique.mockResolvedValue({
    farm_id: FARM_ID,
    fiscal_year: FY,
    total_acres: 5000,
  });
});

describe('updateAccountingCell', () => {
  it('preserves is_actual flag when isActual not passed', async () => {
    // Existing record is already actual
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: { rev_canola: 500 },
      is_actual: true,
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    await updateAccountingCell(FARM_ID, FY, MONTH, 'rev_canola', 1000);

    // First upsert = accounting
    const accountingUpsert = prismaMock.monthlyData.upsert.mock.calls[0][0];
    // update should NOT contain is_actual (since isActual defaults to false)
    expect(accountingUpsert.update).not.toHaveProperty('is_actual');
    // create should preserve existing flag via actualFlag = false || true = true
    expect(accountingUpsert.create.is_actual).toBe(true);
  });

  it('sets is_actual when isActual=true', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      is_actual: false,
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    await updateAccountingCell(FARM_ID, FY, MONTH, 'rev_canola', 1000, { isActual: true });

    // Accounting upsert
    const accountingUpsert = prismaMock.monthlyData.upsert.mock.calls[0][0];
    expect(accountingUpsert.update.is_actual).toBe(true);
    expect(accountingUpsert.create.is_actual).toBe(true);

    // Per-unit upsert
    const perUnitUpsert = prismaMock.monthlyData.upsert.mock.calls[1][0];
    expect(perUnitUpsert.update.is_actual).toBe(true);
  });

  it('cascades to per-unit with correct division', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      is_actual: false,
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updateAccountingCell(FARM_ID, FY, MONTH, 'rev_canola', 5000);

    // 5000 / 5000 acres = 1.0 per acre
    expect(result.perUnit.rev_canola).toBe(1);
  });

  it('handles zero acres without division error', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue({
      farm_id: FARM_ID,
      fiscal_year: FY,
      total_acres: 0,
    });
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      is_actual: false,
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updateAccountingCell(FARM_ID, FY, MONTH, 'rev_canola', 5000);
    expect(result.perUnit.rev_canola).toBe(0); // Should be 0, not Infinity
  });

  it('throws 404 when assumption not found', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue(null);

    await expect(
      updateAccountingCell(FARM_ID, FY, MONTH, 'rev_canola', 1000)
    ).rejects.toThrow('Assumptions not found');
  });

  it('handles negative values correctly', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      is_actual: false,
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updateAccountingCell(FARM_ID, FY, MONTH, 'input_seed', -2500);

    // -2500 / 5000 acres = -0.5 per acre
    expect(result.perUnit.input_seed).toBe(-0.5);
    expect(result.accounting.input_seed).toBe(-2500);
  });

  it('handles fractional values without rounding errors', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      is_actual: false,
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updateAccountingCell(FARM_ID, FY, MONTH, 'rev_canola', 10000);

    // 10000 / 5000 = 2.0 exactly
    expect(result.perUnit.rev_canola).toBe(2);
  });

  it('recalculates parent sums when child updated', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: { rev_canola: 3000, rev_other_income: 500 },
      is_actual: false,
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updateAccountingCell(FARM_ID, FY, MONTH, 'rev_canola', 7000);

    // Parent 'revenue' should be sum of children
    expect(result.accounting.revenue).toBe(7500); // 7000 + 500
  });

  it('preserves other categories when updating one', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: { rev_canola: 3000, input_seed: 1000 },
      is_actual: false,
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updateAccountingCell(FARM_ID, FY, MONTH, 'rev_canola', 5000);

    // input_seed should remain unchanged
    expect(result.accounting.input_seed).toBe(1000);
    expect(result.accounting.rev_canola).toBe(5000);
  });

  it('cascades per-unit values for all categories including parents', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: { rev_other_income: 2000 },
      is_actual: false,
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updateAccountingCell(FARM_ID, FY, MONTH, 'rev_canola', 8000);

    // Per-unit should have parent sums cascaded too
    expect(result.perUnit.rev_canola).toBe(1.6); // 8000 / 5000
    expect(result.perUnit.rev_other_income).toBe(0.4); // 2000 / 5000
    expect(result.perUnit.revenue).toBe(2); // 10000 / 5000
  });
});

describe('updatePerUnitCell', () => {
  it('creates new record when none exists', async () => {
    // No existing monthly data
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 10);

    // Should upsert without error (not crash on null?.data_json)
    expect(result.perUnit.rev_canola).toBe(10);
    expect(result.accounting.rev_canola).toBe(50000); // 10 * 5000 acres
  });

  it('merges with existing data', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: { rev_other_income: 5 },
      comments_json: {},
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 10);

    expect(result.perUnit.rev_canola).toBe(10);
    expect(result.perUnit.rev_other_income).toBe(5);
  });

  it('stores comment when provided', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      comments_json: {},
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    await updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 10, 'test comment');

    const perUnitUpsert = prismaMock.monthlyData.upsert.mock.calls[0][0];
    expect(perUnitUpsert.update.comments_json.rev_canola).toBe('test comment');
  });

  it('does not overwrite comment when undefined', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: {},
      comments_json: { rev_canola: 'existing' },
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    await updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 10);

    const perUnitUpsert = prismaMock.monthlyData.upsert.mock.calls[0][0];
    // Should keep existing comment unchanged
    expect(perUnitUpsert.update.comments_json.rev_canola).toBe('existing');
  });

  it('throws 404 when assumption not found', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue(null);

    await expect(
      updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 10)
    ).rejects.toThrow('Assumptions not found');
  });

  it('multiplies per-unit by acres for accounting values', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 3.50);

    // 3.50 * 5000 = 17500
    expect(result.accounting.rev_canola).toBe(17500);
  });

  it('handles zero per-unit value', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: { rev_canola: 10 },
      comments_json: {},
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 0);

    expect(result.perUnit.rev_canola).toBe(0);
    expect(result.accounting.rev_canola).toBe(0);
  });

  it('handles negative per-unit values', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updatePerUnitCell(FARM_ID, FY, MONTH, 'input_seed', -2.5);

    expect(result.perUnit.input_seed).toBe(-2.5);
    expect(result.accounting.input_seed).toBe(-12500); // -2.5 * 5000
  });

  it('handles small acreage without precision loss', async () => {
    prismaMock.assumption.findUnique.mockResolvedValue({
      farm_id: FARM_ID,
      fiscal_year: FY,
      total_acres: 160, // quarter section
    });
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 25.75);

    expect(result.accounting.rev_canola).toBe(4120); // 25.75 * 160
  });

  it('recalculates parent sums in both layers', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: { rev_other_income: 3 },
      comments_json: {},
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result = await updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 7);

    // Per-unit parent sum
    expect(result.perUnit.revenue).toBe(10); // 7 + 3
    // Accounting parent sum
    expect(result.accounting.revenue).toBe(50000); // 10 * 5000
  });

  it('accounting upsert uses correct composite key', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    await updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 10);

    // Second upsert = accounting
    const accountingUpsert = prismaMock.monthlyData.upsert.mock.calls[1][0];
    expect(accountingUpsert.where.farm_id_fiscal_year_month_type).toEqual({
      farm_id: FARM_ID,
      fiscal_year: FY,
      month: MONTH,
      type: 'accounting',
    });
  });
});

describe('bidirectional consistency', () => {
  it('per-unit → accounting → per-unit roundtrips correctly', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    // Set per-unit to 12.34
    const result1 = await updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 12.34);

    // The accounting value should be 12.34 * 5000 = 61700
    expect(result1.accounting.rev_canola).toBe(61700);

    // Now if we take that accounting value and convert back to per-unit
    // 61700 / 5000 = 12.34 — should be exact
    vi.clearAllMocks();
    prismaMock.assumption.findUnique.mockResolvedValue({
      farm_id: FARM_ID,
      fiscal_year: FY,
      total_acres: 5000,
    });
    prismaMock.monthlyData.findUnique.mockResolvedValue({
      data_json: { rev_canola: 61700 },
      is_actual: false,
    });
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    const result2 = await updateAccountingCell(FARM_ID, FY, MONTH, 'rev_canola', 61700);
    expect(result2.perUnit.rev_canola).toBe(12.34);
  });

  it('large values do not lose precision', async () => {
    prismaMock.monthlyData.findUnique.mockResolvedValue(null);
    prismaMock.monthlyData.upsert.mockResolvedValue({});

    // $500/acre on 5000 acres = $2,500,000
    const result = await updatePerUnitCell(FARM_ID, FY, MONTH, 'rev_canola', 500);
    expect(result.accounting.rev_canola).toBe(2500000);
  });
});
