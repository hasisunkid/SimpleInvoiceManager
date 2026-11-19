import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NumberingNotConfiguredError, assignInvoiceNumber } from '../src/numbering/repository.js';
import { businessYear } from '../src/time.js';
import { createTestApp, type TestApp } from './helpers/setup.js';

let ctx: TestApp;
const year = businessYear();

beforeAll(async () => {
  ctx = await createTestApp('numbering');
});
afterAll(async () => ctx?.close());

const assign = () => ctx.t.db.transaction((trx) => assignInvoiceNumber(trx, year));

describe('number range settings (FR-NUM-01, FR-NUM-04)', () => {
  it('is admin only', async () => {
    expect((await ctx.user.get('/api/settings/numbering')).statusCode).toBe(403);
    const put = await ctx.user.put('/api/settings/numbering', {
      prefix: '',
      minDigits: 0,
      nextValue: 1,
      resetYearly: false,
    });
    expect(put.statusCode).toBe(403);
  });

  it('is unconfigured at first and numbers cannot be assigned yet', async () => {
    const res = await ctx.admin.get('/api/settings/numbering');
    expect(res.json()).toMatchObject({ configured: false, nextNumber: '1', lastAssigned: null });
    await expect(assign()).rejects.toBeInstanceOf(NumberingNotConfiguredError);
  });

  it('validates settings', async () => {
    const base = { prefix: 'RE-', minDigits: 0, nextValue: 104, resetYearly: false };
    const cases = [
      [{ ...base, resetYearly: true }, 'YEARLY_RESET_NEEDS_YEAR'],
      [{ ...base, prefix: 'RE 1' }, 'PREFIX_INVALID'],
      [{ ...base, nextValue: 0 }, 'VALIDATION_FAILED'],
    ] as const;
    for (const [body, error] of cases) {
      const res = await ctx.admin.put('/api/settings/numbering', body);
      expect(res.statusCode, error).toBe(400);
      expect(res.json().error).toBe(error);
    }
  });

  it('sets the start number like the reference invoices (US #7)', async () => {
    const res = await ctx.admin.put('/api/settings/numbering', {
      prefix: '',
      minDigits: 0,
      nextValue: 104,
      resetYearly: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: true, nextNumber: '104', nextValue: 104 });
    expect((await ctx.user.get('/api/company')).json().readiness.missing).not.toContain(
      'numbering',
    );
  });

  it('supports prefix with year and padding', async () => {
    const res = await ctx.admin.put('/api/settings/numbering', {
      prefix: 'RE-{YYYY}-',
      minDigits: 4,
      nextValue: 104,
      resetYearly: true,
    });
    expect(res.json().nextNumber).toBe(`RE-${year}-0104`);
  });
});

describe('number assignment (FR-NUM-02, FR-NUM-03, TR-03)', () => {
  it('assigns consecutive numbers', async () => {
    await ctx.admin.put('/api/settings/numbering', {
      prefix: '',
      minDigits: 0,
      nextValue: 104,
      resetYearly: false,
    });
    expect((await assign()).number).toBe('104');
    expect((await assign()).number).toBe('105');
    expect((await ctx.admin.get('/api/settings/numbering')).json()).toMatchObject({
      lastAssigned: '105',
      nextNumber: '106',
    });
  });

  it('does not consume a number when the finalizing transaction rolls back', async () => {
    await expect(
      ctx.t.db.transaction(async (trx) => {
        await assignInvoiceNumber(trx, year);
        throw new Error('PDF generation failed');
      }),
    ).rejects.toThrow('PDF generation failed');
    expect((await assign()).number).toBe('106');
  });

  it('N parallel finalizations get N distinct, consecutive numbers without gaps', async () => {
    const n = 25;
    const results = await Promise.all(
      Array.from({ length: n }, () =>
        ctx.t.db.transaction(async (trx) => {
          const assigned = await assignInvoiceNumber(trx, year);
          // Simulate the rest of the finalization while holding the lock.
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 15));
          return assigned.value;
        }),
      ),
    );
    const sorted = [...results].sort((a, b) => a - b);
    expect(new Set(results).size).toBe(n);
    expect(sorted).toEqual(Array.from({ length: n }, (_, i) => 107 + i));
  });

  it('refuses to lower the next number below a used one (FR-NUM-04)', async () => {
    const settings = { prefix: '', minDigits: 0, resetYearly: false };
    const lower = await ctx.admin.put('/api/settings/numbering', { ...settings, nextValue: 120 });
    expect(lower.statusCode).toBe(400);
    expect(lower.json().error).toBe('NEXT_VALUE_TOO_LOW');
    const raise = await ctx.admin.put('/api/settings/numbering', { ...settings, nextValue: 200 });
    expect(raise.json().nextNumber).toBe('200');
    expect((await assign()).number).toBe('200');
  });
});
