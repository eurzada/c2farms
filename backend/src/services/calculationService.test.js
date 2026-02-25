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
});
