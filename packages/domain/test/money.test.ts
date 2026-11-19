import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addCents, cents, divRoundHalfUp, formatMoney, parseMoney } from '../src/index.js';

describe('cents', () => {
  it('accepts integers and rejects fractions / unsafe values', () => {
    expect(cents(8000)).toBe(8000);
    expect(() => cents(0.1)).toThrow(RangeError);
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('adds amounts exactly', () => {
    expect(addCents(cents(10), cents(20), cents(-5))).toBe(25);
    expect(addCents()).toBe(0);
  });
});

describe('divRoundHalfUp', () => {
  it('rounds half away from zero', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(5n, -2n)).toBe(-3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(divRoundHalfUp(1520n, 100n)).toBe(15n);
  });

  it('rejects division by zero', () => {
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });

  it('never deviates more than half a unit from the exact quotient', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        (n, d) => {
          const q = divRoundHalfUp(n, d);
          const diff = q * d - n;
          return 2n * (diff < 0n ? -diff : diff) <= d;
        },
      ),
    );
  });
});

describe('parseMoney', () => {
  it.each([
    ['80', 8000],
    ['80,00', 8000],
    ['1.755,00', 175500],
    ['1755.5', 175550],
    ['1,755.00', 175500],
    ['15,2 €', 1520],
    ['-12,34', -1234],
    ['0,05', 5],
    [',5', 50],
  ])('parses %s', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,234,5', '12,345,67', '1.2.3,456', '.'])('rejects %s', (input) => {
    expect(parseMoney(input)).toBeNull();
  });
});

describe('formatMoney (FR-I18N-03)', () => {
  it('formats German like the reference invoices', () => {
    expect(formatMoney(cents(175500), 'de')).toBe('1.755,00 €');
    expect(formatMoney(cents(1520), 'de')).toBe('15,20 €');
    expect(formatMoney(cents(-5), 'de')).toBe('-0,05 €');
  });

  it('formats Polish and English', () => {
    expect(formatMoney(cents(175500), 'pl').replace(/\s/g, ' ')).toBe('1 755,00 €');
    expect(formatMoney(cents(175500), 'en')).toBe('€1,755.00');
    expect(formatMoney(cents(-9520), 'en')).toBe('-€95.20');
  });

  it('round-trips through parseMoney for German formatting', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (n) => {
        return parseMoney(formatMoney(cents(n), 'de')) === n;
      }),
    );
  });
});
