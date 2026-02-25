import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CATEGORIES,
  generateCropRevenueCategories,
  DEFAULT_GL_ACCOUNTS,
  OLD_TO_NEW_CODE_MAP,
} from './defaultCategoryTemplate.js';

describe('DEFAULT_CATEGORIES', () => {
  it('has 16 categories', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(16);
  });

  it('has 5 root parents at level 0', () => {
    const roots = DEFAULT_CATEGORIES.filter(c => c.ref === null);
    expect(roots).toHaveLength(5);
    expect(roots.map(r => r.code)).toEqual(['revenue', 'inputs', 'lpm', 'lbf', 'insurance']);
  });

  it('all children reference a valid parent code', () => {
    const rootCodes = new Set(DEFAULT_CATEGORIES.filter(c => c.ref === null).map(c => c.code));
    const children = DEFAULT_CATEGORIES.filter(c => c.ref !== null);
    for (const child of children) {
      expect(rootCodes.has(child.ref)).toBe(true);
    }
  });

  it('children are level 1', () => {
    const children = DEFAULT_CATEGORIES.filter(c => c.ref !== null);
    for (const child of children) {
      expect(child.level).toBe(1);
    }
  });

  it('every category has required fields', () => {
    for (const cat of DEFAULT_CATEGORIES) {
      expect(cat).toHaveProperty('code');
      expect(cat).toHaveProperty('display_name');
      expect(cat).toHaveProperty('level');
      expect(cat).toHaveProperty('sort_order');
      expect(cat).toHaveProperty('category_type');
    }
  });
});

describe('generateCropRevenueCategories', () => {
  it('returns empty array for null/undefined/empty input', () => {
    expect(generateCropRevenueCategories(null)).toEqual([]);
    expect(generateCropRevenueCategories(undefined)).toEqual([]);
    expect(generateCropRevenueCategories([])).toEqual([]);
  });

  it('generates correct category for single crop', () => {
    const result = generateCropRevenueCategories([{ name: 'Canola' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      code: 'rev_canola',
      display_name: 'Canola Revenue',
      ref: 'revenue',
      level: 1,
      sort_order: 10,
      category_type: 'REVENUE',
    });
  });

  it('generates multiple crops with sequential sort_order', () => {
    const crops = [{ name: 'Canola' }, { name: 'Durum' }, { name: 'Lentils' }];
    const result = generateCropRevenueCategories(crops);
    expect(result).toHaveLength(3);
    expect(result[0].sort_order).toBe(10);
    expect(result[1].sort_order).toBe(11);
    expect(result[2].sort_order).toBe(12);
  });

  it('lowercases and replaces spaces with underscores in code', () => {
    const result = generateCropRevenueCategories([{ name: 'Small Red Lentils' }]);
    expect(result[0].code).toBe('rev_small_red_lentils');
    expect(result[0].display_name).toBe('Small Red Lentils Revenue');
  });

  it('all generated categories ref revenue parent', () => {
    const result = generateCropRevenueCategories([{ name: 'A' }, { name: 'B' }]);
    for (const cat of result) {
      expect(cat.ref).toBe('revenue');
      expect(cat.level).toBe(1);
      expect(cat.category_type).toBe('REVENUE');
    }
  });
});

describe('DEFAULT_GL_ACCOUNTS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(DEFAULT_GL_ACCOUNTS)).toBe(true);
    expect(DEFAULT_GL_ACCOUNTS.length).toBeGreaterThan(0);
  });

  it('every GL account has required fields', () => {
    for (const gl of DEFAULT_GL_ACCOUNTS) {
      expect(gl).toHaveProperty('account_number');
      expect(gl).toHaveProperty('account_name');
      expect(gl).toHaveProperty('category_code');
    }
  });
});

describe('OLD_TO_NEW_CODE_MAP', () => {
  it('is a plain object', () => {
    expect(typeof OLD_TO_NEW_CODE_MAP).toBe('object');
    expect(OLD_TO_NEW_CODE_MAP).not.toBeNull();
  });

  it('maps decomposed categories to null', () => {
    expect(OLD_TO_NEW_CODE_MAP['variable_costs']).toBeNull();
    expect(OLD_TO_NEW_CODE_MAP['fixed_costs']).toBeNull();
  });

  it('maps known old codes to new codes', () => {
    expect(OLD_TO_NEW_CODE_MAP['vc_fuel']).toBe('lpm_fog');
    expect(OLD_TO_NEW_CODE_MAP['fc_rent']).toBe('lbf_rent_interest');
    expect(OLD_TO_NEW_CODE_MAP['input_seed']).toBe('input_seed');
  });
});
