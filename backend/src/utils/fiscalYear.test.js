import { describe, it, expect } from 'vitest';
import {
  CALENDAR_MONTHS,
  FISCAL_MONTHS,
  generateFiscalMonths,
  fiscalMonthIndex,
  calendarToFiscal,
  fiscalToCalendar,
  isFutureMonth,
  isPastMonth,
  getCurrentFiscalMonth,
  parseYear,
  isValidMonth,
} from './fiscalYear.js';

describe('CALENDAR_MONTHS', () => {
  it('has 12 months starting with Jan', () => {
    expect(CALENDAR_MONTHS).toHaveLength(12);
    expect(CALENDAR_MONTHS[0]).toBe('Jan');
    expect(CALENDAR_MONTHS[11]).toBe('Dec');
  });
});

describe('generateFiscalMonths', () => {
  it('defaults to Nov start', () => {
    const months = generateFiscalMonths();
    expect(months).toEqual(['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
  });

  it('handles Jan start (calendar year)', () => {
    expect(generateFiscalMonths('Jan')).toEqual(CALENDAR_MONTHS);
  });

  it('handles Jul start', () => {
    const months = generateFiscalMonths('Jul');
    expect(months[0]).toBe('Jul');
    expect(months[11]).toBe('Jun');
    expect(months).toHaveLength(12);
  });
});

describe('FISCAL_MONTHS', () => {
  it('is the default Nov-Oct sequence', () => {
    expect(FISCAL_MONTHS).toEqual(generateFiscalMonths('Nov'));
  });
});

describe('fiscalMonthIndex', () => {
  it('returns 0 for Nov in Nov-start FY', () => {
    expect(fiscalMonthIndex('Nov')).toBe(0);
  });

  it('returns 2 for Jan in Nov-start FY', () => {
    expect(fiscalMonthIndex('Jan')).toBe(2);
  });

  it('returns -1 for invalid month', () => {
    expect(fiscalMonthIndex('Foo')).toBe(-1);
  });

  it('respects custom start month', () => {
    expect(fiscalMonthIndex('Jul', 'Jul')).toBe(0);
    expect(fiscalMonthIndex('Jun', 'Jul')).toBe(11);
  });
});

describe('calendarToFiscal', () => {
  it('Nov 2024 → FY 2025', () => {
    const result = calendarToFiscal(new Date(2024, 10, 15)); // Nov 15 2024
    expect(result).toEqual({ fiscalYear: 2025, monthName: 'Nov' });
  });

  it('Jan 2025 → FY 2025', () => {
    const result = calendarToFiscal(new Date(2025, 0, 1)); // Jan 1 2025
    expect(result).toEqual({ fiscalYear: 2025, monthName: 'Jan' });
  });

  it('Oct 2025 → FY 2025 (last month of FY)', () => {
    const result = calendarToFiscal(new Date(2025, 9, 31));
    expect(result).toEqual({ fiscalYear: 2025, monthName: 'Oct' });
  });

  it('Dec 2024 → FY 2025', () => {
    const result = calendarToFiscal(new Date(2024, 11, 1));
    expect(result).toEqual({ fiscalYear: 2025, monthName: 'Dec' });
  });
});

describe('fiscalToCalendar', () => {
  it('FY 2025 Nov → Nov 1 2024', () => {
    const date = fiscalToCalendar(2025, 'Nov');
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(10); // Nov = 10
    expect(date.getDate()).toBe(1);
  });

  it('FY 2025 Jan → Jan 1 2025', () => {
    const date = fiscalToCalendar(2025, 'Jan');
    expect(date.getFullYear()).toBe(2025);
    expect(date.getMonth()).toBe(0);
  });

  it('roundtrips with calendarToFiscal', () => {
    const original = new Date(2025, 3, 1); // Apr 1 2025
    const { fiscalYear, monthName } = calendarToFiscal(original);
    const back = fiscalToCalendar(fiscalYear, monthName);
    expect(back.getFullYear()).toBe(2025);
    expect(back.getMonth()).toBe(3);
  });
});

describe('isFutureMonth', () => {
  it('far future month returns true', () => {
    expect(isFutureMonth(2099, 'Jan')).toBe(true);
  });

  it('far past month returns false', () => {
    expect(isFutureMonth(2020, 'Jan')).toBe(false);
  });
});

describe('isPastMonth', () => {
  it('far past month returns true', () => {
    expect(isPastMonth(2020, 'Jan')).toBe(true);
  });

  it('far future month returns false', () => {
    expect(isPastMonth(2099, 'Jan')).toBe(false);
  });
});

describe('getCurrentFiscalMonth', () => {
  it('returns an object with fiscalYear and monthName', () => {
    const result = getCurrentFiscalMonth();
    expect(result).toHaveProperty('fiscalYear');
    expect(result).toHaveProperty('monthName');
    expect(typeof result.fiscalYear).toBe('number');
    expect(CALENDAR_MONTHS).toContain(result.monthName);
  });
});

describe('parseYear', () => {
  it('parses valid year', () => {
    expect(parseYear('2025')).toBe(2025);
    expect(parseYear(2025)).toBe(2025);
  });

  it('returns null for NaN', () => {
    expect(parseYear('abc')).toBeNull();
    expect(parseYear(undefined)).toBeNull();
  });

  it('returns null for out-of-range', () => {
    expect(parseYear(1999)).toBeNull();
    expect(parseYear(2101)).toBeNull();
  });

  it('accepts boundary values', () => {
    expect(parseYear(2000)).toBe(2000);
    expect(parseYear(2100)).toBe(2100);
  });
});

describe('isValidMonth', () => {
  it('returns true for valid months', () => {
    expect(isValidMonth('Jan')).toBe(true);
    expect(isValidMonth('Dec')).toBe(true);
  });

  it('returns false for invalid strings', () => {
    expect(isValidMonth('jan')).toBe(false);
    expect(isValidMonth('January')).toBe(false);
    expect(isValidMonth('')).toBe(false);
  });
});
