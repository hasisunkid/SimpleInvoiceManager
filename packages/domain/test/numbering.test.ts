import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  applyNumberingSettings,
  assignNumber,
  effectiveNextValue,
  formatInvoiceNumber,
  validateNumbering,
  type NumberingState,
} from '../src/index.js';

const fresh: NumberingState = {
  prefix: '',
  minDigits: 0,
  nextValue: 104,
  resetYearly: false,
  currentYear: null,
  lastAssigned: null,
};

describe('formatInvoiceNumber (FR-NUM-01)', () => {
  it('defaults to a plain integer like the reference invoices', () => {
    expect(formatInvoiceNumber(fresh, 104, 2024)).toBe('104');
  });

  it('supports prefix, year placeholder and padding', () => {
    expect(formatInvoiceNumber({ prefix: 'RE-{YYYY}-', minDigits: 4 }, 7, 2026)).toBe(
      'RE-2026-0007',
    );
    expect(formatInvoiceNumber({ prefix: '{YYYY}/{YYYY}/', minDigits: 0 }, 12, 2026)).toBe(
      '2026/2026/12',
    );
  });
});

describe('assignNumber (FR-NUM-02, FR-NUM-03)', () => {
  it('assigns consecutive numbers starting at the configured start number', () => {
    const a = assignNumber(fresh, 2026);
    const b = assignNumber(a.state, 2026);
    expect([a.number, b.number]).toEqual(['104', '105']);
    expect(b.state).toMatchObject({ nextValue: 106, lastAssigned: 105, currentYear: 2026 });
  });

  it('restarts at 1 in a new year when yearly reset is on', () => {
    const state = { ...fresh, prefix: 'RE-{YYYY}-', resetYearly: true };
    const dec = assignNumber(state, 2026);
    const jan = assignNumber(dec.state, 2027);
    expect([dec.number, jan.number]).toEqual(['RE-2026-104', 'RE-2027-1']);
    expect(effectiveNextValue(jan.state, 2027)).toBe(2);
    expect(effectiveNextValue(jan.state, 2028)).toBe(1);
  });

  it('continues counting across years without yearly reset', () => {
    const dec = assignNumber(fresh, 2026);
    expect(assignNumber(dec.state, 2027).number).toBe('105');
  });

  it('does not move the year backwards if the clock does', () => {
    const state = assignNumber({ ...fresh, prefix: '{YYYY}-', resetYearly: true }, 2027).state;
    expect(assignNumber(state, 2026).state.currentYear).toBe(2027);
  });

  it('refuses to exceed the number range', () => {
    expect(() => assignNumber({ ...fresh, nextValue: 100_000_000 }, 2026)).toThrow(RangeError);
  });

  it('never repeats a number within a period (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 60 }),
        fc.boolean(),
        (start, yearSteps, resetYearly) => {
          let state: NumberingState = {
            ...fresh,
            prefix: '{YYYY}-',
            nextValue: start,
            resetYearly,
          };
          let year = 2026;
          const seen = new Set<string>();
          for (const step of yearSteps) {
            year += step === 2 ? 1 : 0;
            const result = assignNumber(state, year);
            if (seen.has(result.number)) return false;
            seen.add(result.number);
            // Consecutive within a period.
            if (state.lastAssigned !== null && result.state.currentYear === state.currentYear) {
              if (result.value !== state.lastAssigned + 1) return false;
            }
            state = result.state;
          }
          return true;
        },
      ),
    );
  });
});

describe('applyNumberingSettings', () => {
  const settings = { prefix: '{YYYY}-', minDigits: 0, nextValue: 5, resetYearly: true };

  it('keeps the period when no reset is due', () => {
    const state = { ...fresh, ...settings, currentYear: 2026, lastAssigned: 3 };
    expect(applyNumberingSettings(state, settings, 2026)).toMatchObject({
      nextValue: 5,
      currentYear: 2026,
      lastAssigned: 3,
    });
  });

  it('starts the new period with the chosen start number when a reset is due', () => {
    const state = { ...fresh, ...settings, currentYear: 2026, lastAssigned: 50 };
    const next = applyNumberingSettings(state, settings, 2027);
    expect(next).toMatchObject({ nextValue: 5, currentYear: 2027, lastAssigned: null });
    expect(assignNumber(next, 2027).number).toBe('2027-5');
  });
});

describe('validateNumbering (FR-NUM-01, FR-NUM-04)', () => {
  const ok = { prefix: 'RE-', minDigits: 0, nextValue: 1, resetYearly: false };

  it('accepts any start number before the first invoice', () => {
    expect(validateNumbering(ok, fresh, 2026)).toEqual([]);
  });

  it('allows raising but not lowering below the last used number', () => {
    const used = { ...fresh, lastAssigned: 110, nextValue: 111, currentYear: 2026 };
    expect(validateNumbering({ ...ok, nextValue: 111 }, used, 2026)).toEqual([]);
    expect(validateNumbering({ ...ok, nextValue: 500 }, used, 2026)).toEqual([]);
    expect(validateNumbering({ ...ok, nextValue: 110 }, used, 2026)).toEqual([
      'NEXT_VALUE_TOO_LOW',
    ]);
  });

  it('allows a low start number once a yearly reset is due', () => {
    const used = {
      ...fresh,
      prefix: '{YYYY}-',
      resetYearly: true,
      lastAssigned: 50,
      currentYear: 2026,
    };
    const settings = { ...ok, prefix: '{YYYY}-', resetYearly: true, nextValue: 1 };
    expect(validateNumbering(settings, used, 2027)).toEqual([]);
    expect(validateNumbering(settings, used, 2026)).toEqual(['NEXT_VALUE_TOO_LOW']);
  });

  it('requires the year in the prefix for yearly reset', () => {
    expect(validateNumbering({ ...ok, resetYearly: true }, fresh, 2026)).toEqual([
      'YEARLY_RESET_NEEDS_YEAR',
    ]);
  });

  it('rejects unsafe prefixes and out-of-range values', () => {
    expect(validateNumbering({ ...ok, prefix: 'RE {X}' }, fresh, 2026)).toContain('PREFIX_INVALID');
    expect(validateNumbering({ ...ok, prefix: 'x'.repeat(21) }, fresh, 2026)).toContain(
      'PREFIX_INVALID',
    );
    expect(validateNumbering({ ...ok, minDigits: 9 }, fresh, 2026)).toContain('MIN_DIGITS_INVALID');
    expect(validateNumbering({ ...ok, nextValue: 0 }, fresh, 2026)).toContain('NEXT_VALUE_INVALID');
    expect(validateNumbering({ ...ok, nextValue: 1.5 }, fresh, 2026)).toContain(
      'NEXT_VALUE_INVALID',
    );
  });
});
