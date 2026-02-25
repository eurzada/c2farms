import { describe, it, expect } from 'vitest';
import { recalcParentSums } from './categoryService.js';

// Minimal category hierarchy for testing (mimics FarmCategory rows)
function makeFarmCategories() {
  return [
    { id: '1', code: 'revenue', parent_id: null, level: 0 },
    { id: '2', code: 'rev_canola', parent_id: '1', level: 1 },
    { id: '3', code: 'rev_durum', parent_id: '1', level: 1 },
    { id: '4', code: 'rev_other_income', parent_id: '1', level: 1 },
    { id: '5', code: 'inputs', parent_id: null, level: 0 },
    { id: '6', code: 'input_seed', parent_id: '5', level: 1 },
    { id: '7', code: 'input_fert', parent_id: '5', level: 1 },
    { id: '8', code: 'input_chem', parent_id: '5', level: 1 },
  ];
}

describe('recalcParentSums', () => {
  it('sums children into parent', () => {
    const data = { rev_canola: 100, rev_durum: 200, rev_other_income: 50 };
    const result = recalcParentSums(data, makeFarmCategories());
    expect(result.revenue).toBe(350);
  });

  it('sums input children into inputs parent', () => {
    const data = { input_seed: 30, input_fert: 40, input_chem: 10 };
    const result = recalcParentSums(data, makeFarmCategories());
    expect(result.inputs).toBe(80);
  });

  it('handles zero values correctly', () => {
    const data = { rev_canola: 0, rev_durum: 0, rev_other_income: 0 };
    const result = recalcParentSums(data, makeFarmCategories());
    expect(result.revenue).toBe(0);
  });

  it('handles missing child values (defaults to 0)', () => {
    const data = { rev_canola: 100 }; // durum and other_income missing
    const result = recalcParentSums(data, makeFarmCategories());
    expect(result.revenue).toBe(100);
  });

  it('preserves leaf values', () => {
    const data = { rev_canola: 100, input_seed: 50 };
    const result = recalcParentSums(data, makeFarmCategories());
    expect(result.rev_canola).toBe(100);
    expect(result.input_seed).toBe(50);
  });

  it('preserves extra keys not in categories', () => {
    const data = { rev_canola: 100, _extra_key: 999 };
    const result = recalcParentSums(data, makeFarmCategories());
    expect(result._extra_key).toBe(999);
  });

  it('does not mutate input', () => {
    const data = { rev_canola: 100 };
    const original = { ...data };
    recalcParentSums(data, makeFarmCategories());
    expect(data).toEqual(original);
  });

  it('handles empty data', () => {
    const result = recalcParentSums({}, makeFarmCategories());
    expect(result.revenue).toBe(0);
    expect(result.inputs).toBe(0);
  });

  it('handles empty categories', () => {
    const data = { some_key: 42 };
    const result = recalcParentSums(data, []);
    expect(result.some_key).toBe(42);
  });

  it('handles negative values', () => {
    const data = { rev_canola: -50, rev_durum: 100, rev_other_income: 0 };
    const result = recalcParentSums(data, makeFarmCategories());
    expect(result.revenue).toBe(50);
  });

  it('handles multi-level hierarchy bottom-up', () => {
    // Simulate a 3-level hierarchy: grandparent > parent > child
    const cats = [
      { id: 'gp', code: 'grandparent', parent_id: null, level: 0 },
      { id: 'p', code: 'parent', parent_id: 'gp', level: 1 },
      { id: 'c1', code: 'child1', parent_id: 'p', level: 2 },
      { id: 'c2', code: 'child2', parent_id: 'p', level: 2 },
    ];
    const data = { child1: 10, child2: 20 };
    const result = recalcParentSums(data, cats);
    expect(result.parent).toBe(30);
    expect(result.grandparent).toBe(30);
  });
});
