import { describe, expect, it } from 'vitest';
import { addDays, formatDate, isIsoDate } from '../src/index.js';

describe('dates', () => {
  it('validates ISO dates including leap years', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2024-13-01')).toBe(false);
    expect(isIsoDate('22.05.2024')).toBe(false);
  });

  it('computes due dates across month and year boundaries', () => {
    expect(addDays('2024-05-22', 30)).toBe('2024-06-21');
    expect(addDays('2024-12-15', 30)).toBe('2025-01-14');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('formats in the document language', () => {
    expect(formatDate('2024-05-22', 'de')).toBe('22.05.2024');
    expect(formatDate('2024-05-22', 'pl')).toBe('22.05.2024');
    expect(formatDate('2024-05-22', 'en')).toBe('22/05/2024');
  });

  it('rejects invalid input', () => {
    expect(() => formatDate('2024-02-30', 'de')).toThrow(RangeError);
  });
});
