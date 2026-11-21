import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  VAT_RATES,
  calculateInvoice,
  lineTotalCents,
  parseQuantity,
  vatCategory,
  type PositionAmounts,
  type TaxMode,
} from '../src/index.js';

const lumpSum = (type: 'WORK' | 'MATERIAL', cents: number, vatRate: 19 | 7 | 0 = 19) => ({
  type,
  quantityMilli: 1000,
  unitPriceCents: cents,
  vatRate,
});

describe('line totals (FR-INV-06)', () => {
  it('multiplies quantity and price and rounds half up', () => {
    expect(lineTotalCents(1000, 8000)).toBe(8000);
    expect(lineTotalCents(1500, 4800)).toBe(7200);
    expect(lineTotalCents(333, 100)).toBe(33); // 0,333 × 1,00 € = 0,333 €
    expect(lineTotalCents(335, 100)).toBe(34); // 0,335 € → 0,34 € (half up)
    expect(lineTotalCents(12_345, 999)).toBe(12_333); // 12,345 × 9,99 = 123,32655 €
  });
});

describe('reference invoices (Appendix A)', () => {
  it('102 Illing: 80,00 € + 19 % = 95,20 €', () => {
    const { totals } = calculateInvoice([lumpSum('WORK', 8000)], 'REGULAR');
    expect(totals).toMatchObject({ netCents: 8000, vatCents: 1520, grossCents: 9520 });
    expect(totals.vatGroups).toEqual([{ rate: 19, netCents: 8000, vatCents: 1520 }]);
  });

  it('104 Karaca adapted to 19 %: work and material sections', () => {
    const { totals } = calculateInvoice(
      [lumpSum('WORK', 175_500), lumpSum('MATERIAL', 64_000)],
      'REGULAR',
    );
    expect(totals).toMatchObject({ netCents: 239_500, vatCents: 45_505, grossCents: 285_005 });
    expect(totals.sections).toEqual({
      WORK: { netCents: 175_500 },
      MATERIAL: { netCents: 64_000 },
    });
    // § 35a: labour incl. VAT = 1.755,00 + 333,45
    expect(totals.labourCostInclVatCents).toBe(208_845);
  });
});

describe('VAT grouping', () => {
  it('rounds VAT once per rate, not per line', () => {
    // 3 × 0,10 € at 19 %: per line 0,019 → 0,02 each (0,06), per rate 0,30 × 19 % = 0,057 → 0,06
    // 3 × 0,05 € at 19 %: per line 0,0095 → 0,01 each (0,03), per rate 0,15 × 19 % = 0,0285 → 0,03
    // 7 × 0,03 € at 19 %: per line 0,0057 → 0,01 each (0,07), per rate 0,21 × 19 % = 0,0399 → 0,04
    const lines = Array.from({ length: 7 }, () => lumpSum('MATERIAL', 3));
    expect(calculateInvoice(lines, 'REGULAR').totals.vatCents).toBe(4);
  });

  it('groups by rate, highest first, and allows 0 % lines', () => {
    const { totals, positions } = calculateInvoice(
      [
        lumpSum('WORK', 1000, 7),
        lumpSum('WORK', 2000, 19),
        lumpSum('MATERIAL', 500, 0),
        lumpSum('MATERIAL', 3000, 19),
      ],
      'REGULAR',
    );
    expect(totals.vatGroups).toEqual([
      { rate: 19, netCents: 5000, vatCents: 950 },
      { rate: 7, netCents: 1000, vatCents: 70 },
      { rate: 0, netCents: 500, vatCents: 0 },
    ]);
    expect(positions.map((p) => p.vatCategory)).toEqual(['S', 'S', 'Z', 'S']);
    // Labour: 1000 + 70 (7 %) + 2000 + 380 (19 %)
    expect(totals.labourCostInclVatCents).toBe(3450);
  });

  it('handles an empty invoice', () => {
    expect(calculateInvoice([], 'REGULAR').totals).toMatchObject({
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
      vatGroups: [],
      labourCostInclVatCents: 0,
    });
  });
});

describe('Kleinunternehmer § 19 UStG', () => {
  it('charges no VAT and marks positions exempt', () => {
    const { totals, positions } = calculateInvoice(
      [lumpSum('WORK', 175_500), lumpSum('MATERIAL', 64_000, 7)],
      'SMALL_BUSINESS_19',
    );
    expect(totals).toMatchObject({
      netCents: 239_500,
      vatCents: 0,
      grossCents: 239_500,
      vatGroups: [],
    });
    expect(totals.labourCostInclVatCents).toBe(175_500);
    expect(positions.every((p) => p.vatRate === 0 && p.vatCategory === 'E')).toBe(true);
  });

  it('maps VAT categories', () => {
    expect(vatCategory(19, 'REGULAR')).toBe('S');
    expect(vatCategory(0, 'REGULAR')).toBe('Z');
    expect(vatCategory(19, 'SMALL_BUSINESS_19')).toBe('E');
  });
});

describe('calculation invariants (TR-01, property-based)', () => {
  const position: fc.Arbitrary<PositionAmounts> = fc.record({
    type: fc.constantFrom('WORK' as const, 'MATERIAL' as const),
    quantityMilli: fc.integer({ min: 1, max: 10_000_000 }),
    unitPriceCents: fc.integer({ min: 0, max: 10_000_000 }),
    vatRate: fc.constantFrom(...VAT_RATES),
  });
  const taxMode = fc.constantFrom<TaxMode>('REGULAR', 'SMALL_BUSINESS_19');

  it('gross = net + VAT, net = Σ lines = Σ sections = Σ groups', () => {
    fc.assert(
      fc.property(fc.array(position, { maxLength: 40 }), taxMode, (lines, mode) => {
        const { totals, positions } = calculateInvoice(lines, mode);
        const sumLines = positions.reduce((s, p) => s + p.lineTotalCents, 0);
        const sumSections = totals.sections.WORK.netCents + totals.sections.MATERIAL.netCents;
        const sumGroupNet = totals.vatGroups.reduce((s, g) => s + g.netCents, 0);
        const sumGroupVat = totals.vatGroups.reduce((s, g) => s + g.vatCents, 0);
        return (
          totals.grossCents === totals.netCents + totals.vatCents &&
          totals.netCents === sumLines &&
          totals.netCents === sumSections &&
          totals.vatCents === sumGroupVat &&
          (mode === 'SMALL_BUSINESS_19' ? totals.vatCents === 0 : sumGroupNet === totals.netCents)
        );
      }),
    );
  });

  it('every amount is an integer and VAT is within half a cent of exact per rate', () => {
    fc.assert(
      fc.property(fc.array(position, { maxLength: 40 }), (lines) => {
        const { totals } = calculateInvoice(lines, 'REGULAR');
        return totals.vatGroups.every(
          (g) =>
            Number.isSafeInteger(g.vatCents) &&
            Math.abs(g.vatCents * 100 - g.netCents * g.rate) <= 50,
        );
      }),
    );
  });

  it('labour incl. VAT lies between labour net and the whole gross', () => {
    fc.assert(
      fc.property(fc.array(position, { maxLength: 40 }), taxMode, (lines, mode) => {
        const { totals } = calculateInvoice(lines, mode);
        return (
          totals.labourCostInclVatCents >= totals.sections.WORK.netCents &&
          totals.labourCostInclVatCents <= totals.grossCents
        );
      }),
    );
  });

  it('does not depend on the order of positions', () => {
    fc.assert(
      fc.property(fc.array(position, { maxLength: 20 }), taxMode, (lines, mode) => {
        const a = calculateInvoice(lines, mode).totals;
        const b = calculateInvoice([...lines].reverse(), mode).totals;
        return JSON.stringify(a) === JSON.stringify(b);
      }),
    );
  });
});

describe('parseQuantity', () => {
  it.each([
    ['1', 1000],
    ['1,5', 1500],
    ['2.25', 2250],
    ['0,125', 125],
    ['1,250', 1250],
    [' 12 ', 12000],
  ])('parses %s', (input, expected) => {
    expect(parseQuantity(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,2345', '1.000,5', '-1', '1e3'])('rejects %s', (input) => {
    expect(parseQuantity(input)).toBeNull();
  });
});
