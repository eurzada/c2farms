import { describe, it, expect } from 'vitest';
import { buildStatementRows, formatCurrency } from './exportService.js';

const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

// Minimal full category hierarchy for testing
function makeCategories() {
  return [
    { id: '1', code: 'revenue', display_name: 'Revenue', parent_id: null, level: 0 },
    { id: '2', code: 'rev_canola', display_name: 'Canola Revenue', parent_id: '1', level: 1 },
    { id: '3', code: 'rev_other_income', display_name: 'Other Income', parent_id: '1', level: 1 },
    { id: '4', code: 'inputs', display_name: 'Inputs', parent_id: null, level: 0 },
    { id: '5', code: 'input_seed', display_name: 'Seed', parent_id: '4', level: 1 },
    { id: '6', code: 'input_fert', display_name: 'Fertilizer', parent_id: '4', level: 1 },
    { id: '7', code: 'lpm', display_name: 'LPM - Labour Power Machinery', parent_id: null, level: 0 },
    { id: '8', code: 'lpm_personnel', display_name: 'Personnel', parent_id: '7', level: 1 },
    { id: '9', code: 'insurance', display_name: 'Insurance', parent_id: null, level: 0 },
    { id: '10', code: 'ins_crop', display_name: 'Crop Insurance', parent_id: '9', level: 1 },
  ];
}

// Helper: build a dataMap where every month has the same data
function uniformDataMap(data) {
  const map = {};
  for (const m of MONTHS) map[m] = { ...data };
  return map;
}

describe('formatCurrency', () => {
  it('returns dash for zero', () => {
    expect(formatCurrency(0)).toBe('-');
  });

  it('returns dash for negative zero', () => {
    expect(formatCurrency(-0)).toBe('-');
  });

  it('formats positive values with commas', () => {
    expect(formatCurrency(1234.56)).toBe('1,234.56');
  });

  it('formats negative values in parentheses', () => {
    expect(formatCurrency(-1234.56)).toBe('(1,234.56)');
  });

  it('returns dash for near-zero floating point artifact', () => {
    expect(formatCurrency(5.551115123125783e-17)).toBe('-');
    expect(formatCurrency(-1.1368683772161603e-13)).toBe('-');
  });

  it('returns dash for sub-cent positive value', () => {
    expect(formatCurrency(0.004)).toBe('-');
    expect(formatCurrency(0.0049)).toBe('-');
  });

  it('does not return dash at the 0.005 boundary', () => {
    // 0.005 rounds to 0.01 at 2 decimal places — should display, not dash
    expect(formatCurrency(0.005)).not.toBe('-');
  });

  it('formats small positive values correctly', () => {
    expect(formatCurrency(0.01)).toBe('0.01');
  });

  it('formats small negative values in parentheses', () => {
    expect(formatCurrency(-0.01)).toBe('(0.01)');
  });

  it('returns dash for small negative near-zero', () => {
    expect(formatCurrency(-0.004)).toBe('-');
  });
});

describe('buildStatementRows', () => {
  it('produces correct row structure with all section types', () => {
    const dataMap = uniformDataMap({
      revenue: 1000, rev_canola: 800, rev_other_income: 200,
      inputs: 300, input_seed: 100, input_fert: 200,
      lpm: 150, lpm_personnel: 150,
      insurance: 50, ins_crop: 50,
    });

    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);
    const types = rows.map(r => r.type);

    // Revenue section: header, 2 children, subtotal, blank
    expect(types[0]).toBe('header');
    expect(types[1]).toBe('child');
    expect(types[2]).toBe('child');
    expect(types[3]).toBe('subtotal');
    expect(types[4]).toBe('blank');

    // Should end with: grandTotal, blank, profit
    expect(types[types.length - 3]).toBe('grandTotal');
    expect(types[types.length - 2]).toBe('blank');
    expect(types[types.length - 1]).toBe('profit');
  });

  it('computes correct subtotal values from dataMap parent sums', () => {
    const dataMap = uniformDataMap({
      revenue: 1000, rev_canola: 800, rev_other_income: 200,
      inputs: 300, input_seed: 100, input_fert: 200,
      lpm: 150, lpm_personnel: 150,
      insurance: 50, ins_crop: 50,
    });

    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);
    const revenueSubtotal = rows.find(r => r.type === 'subtotal' && r.label === 'Total Revenue');
    expect(revenueSubtotal.values[0]).toBe(1000);
    expect(revenueSubtotal.total).toBe(12000);
  });

  it('computes Total Expenses as sum of expense group parents', () => {
    const dataMap = uniformDataMap({
      revenue: 1000, rev_canola: 1000,
      inputs: 300, input_seed: 300,
      lpm: 150, lpm_personnel: 150,
      insurance: 50, ins_crop: 50,
    });

    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);
    const grandTotal = rows.find(r => r.type === 'grandTotal');
    // 300 + 150 + 50 = 500 per month
    expect(grandTotal.values[0]).toBe(500);
    expect(grandTotal.total).toBe(6000);
  });

  it('computes Net Profit as Revenue minus Total Expenses', () => {
    const dataMap = uniformDataMap({
      revenue: 1000, rev_canola: 1000,
      inputs: 300, input_seed: 300,
      lpm: 150, lpm_personnel: 150,
      insurance: 50, ins_crop: 50,
    });

    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);
    const profit = rows.find(r => r.type === 'profit');
    // 1000 - 500 = 500 per month
    expect(profit.values[0]).toBe(500);
    expect(profit.total).toBe(6000);
  });

  it('handles all-zero data — values are all zero', () => {
    const dataMap = uniformDataMap({});

    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);
    const profit = rows.find(r => r.type === 'profit');
    expect(profit.values.every(v => v === 0)).toBe(true);
    expect(profit.total).toBe(0);

    const grandTotal = rows.find(r => r.type === 'grandTotal');
    expect(grandTotal.values.every(v => v === 0)).toBe(true);
  });

  it('handles missing months in dataMap — treats as zero', () => {
    // Only provide data for Nov, leave all other months missing
    const dataMap = {
      Nov: { revenue: 1000, rev_canola: 1000, inputs: 200, input_seed: 200 },
    };

    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);
    const profit = rows.find(r => r.type === 'profit');
    // Nov: 1000 - 200 = 800, all other months: 0 - 0 = 0
    expect(profit.values[0]).toBe(800);
    expect(profit.values[1]).toBe(0);
    expect(profit.total).toBe(800);
  });

  it('handles empty dataMap', () => {
    const rows = buildStatementRows(makeCategories(), {}, MONTHS);
    const profit = rows.find(r => r.type === 'profit');
    expect(profit.total).toBe(0);
  });

  it('handles empty categories — still produces grandTotal and profit', () => {
    const rows = buildStatementRows([], uniformDataMap({}), MONTHS);
    const types = rows.map(r => r.type);
    expect(types).toContain('grandTotal');
    expect(types).toContain('profit');
  });

  it('rounds computed Total Expenses to avoid floating point artifacts', () => {
    // Use values that cause floating point issues when summed
    const dataMap = uniformDataMap({
      revenue: 100, rev_canola: 100,
      inputs: 0.1, input_seed: 0.1,
      lpm: 0.2, lpm_personnel: 0.2,
      insurance: 0, ins_crop: 0,
    });

    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);
    const grandTotal = rows.find(r => r.type === 'grandTotal');
    // 0.1 + 0.2 = 0.30000000000000004 without rounding
    expect(grandTotal.values[0]).toBe(0.3);
  });

  it('rounds Net Profit to avoid floating point near-zero', () => {
    // Revenue exactly equals expenses — profit should be exactly 0
    const dataMap = uniformDataMap({
      revenue: 500.10, rev_canola: 500.10,
      inputs: 200.05, input_seed: 200.05,
      lpm: 200.03, lpm_personnel: 200.03,
      insurance: 100.02, ins_crop: 100.02,
    });

    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);
    const profit = rows.find(r => r.type === 'profit');
    // 500.10 - (200.05 + 200.03 + 100.02) = 500.10 - 500.10 = 0
    expect(profit.values[0]).toBe(0);
    expect(profit.total).toBe(0);
  });

  it('produces negative profit when expenses exceed revenue', () => {
    const dataMap = uniformDataMap({
      revenue: 100, rev_canola: 100,
      inputs: 200, input_seed: 200,
      lpm: 0, lpm_personnel: 0,
      insurance: 0, ins_crop: 0,
    });

    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);
    const profit = rows.find(r => r.type === 'profit');
    expect(profit.values[0]).toBe(-100);
    expect(profit.total).toBe(-1200);
  });

  it('abbreviates long section names in subtotal labels', () => {
    const dataMap = uniformDataMap({});
    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);

    const lpmSubtotal = rows.find(r => r.type === 'subtotal' && r.label.includes('LPM'));
    // "LPM - Labour Power Machinery" should become "Total LPM"
    expect(lpmSubtotal.label).toBe('Total LPM');
  });

  it('does not abbreviate names without a dash', () => {
    const dataMap = uniformDataMap({});
    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);

    const revenueSubtotal = rows.find(r => r.type === 'subtotal' && r.label.includes('Revenue'));
    expect(revenueSubtotal.label).toBe('Total Revenue');

    const inputsSubtotal = rows.find(r => r.type === 'subtotal' && r.label.includes('Inputs'));
    expect(inputsSubtotal.label).toBe('Total Inputs');
  });

  it('handles parent with no children', () => {
    const cats = [
      { id: '1', code: 'revenue', display_name: 'Revenue', parent_id: null, level: 0 },
      // no children for revenue
      { id: '2', code: 'inputs', display_name: 'Inputs', parent_id: null, level: 0 },
      { id: '3', code: 'input_seed', display_name: 'Seed', parent_id: '2', level: 1 },
    ];
    const dataMap = uniformDataMap({ revenue: 0, inputs: 100, input_seed: 100 });

    const rows = buildStatementRows(cats, dataMap, MONTHS);
    // Revenue section should still have header + subtotal (no children between)
    expect(rows[0].type).toBe('header');
    expect(rows[0].label).toBe('Revenue');
    expect(rows[1].type).toBe('subtotal');
    expect(rows[1].label).toBe('Total Revenue');
  });

  it('child row values array has correct length matching months', () => {
    const dataMap = uniformDataMap({ rev_canola: 100 });
    const rows = buildStatementRows(makeCategories(), dataMap, MONTHS);
    const child = rows.find(r => r.type === 'child');
    expect(child.values).toHaveLength(MONTHS.length);
  });

  it('revenue-only farm with no expense groups', () => {
    const cats = [
      { id: '1', code: 'revenue', display_name: 'Revenue', parent_id: null, level: 0 },
      { id: '2', code: 'rev_canola', display_name: 'Canola Revenue', parent_id: '1', level: 1 },
    ];
    const dataMap = uniformDataMap({ revenue: 500, rev_canola: 500 });

    const rows = buildStatementRows(cats, dataMap, MONTHS);
    const grandTotal = rows.find(r => r.type === 'grandTotal');
    const profit = rows.find(r => r.type === 'profit');

    expect(grandTotal.values[0]).toBe(0); // no expenses
    expect(profit.values[0]).toBe(500);   // all revenue is profit
  });
});
