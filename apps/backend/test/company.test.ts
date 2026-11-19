import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/setup.js';
import { TestClient } from './helpers/client.js';
import { COMPLETE_COMPANY } from './helpers/fixtures.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp('company');
});
afterAll(async () => ctx?.close());

describe('company profile (FR-COMP-01..04)', () => {
  it('starts empty with defaults and seeded closing texts', async () => {
    const res = await ctx.user.get('/api/company');
    expect(res.statusCode).toBe(200);
    const { profile, readiness } = res.json();
    expect(profile).toMatchObject({
      name: '',
      countryCode: 'DE',
      taxMode: 'REGULAR',
      defaultPaymentTermDays: 30,
      defaultVatRate: 19,
    });
    expect(profile.closingTexts.de).toContain('Wir bedanken uns');
    expect(profile.introTexts).toEqual({ de: '', pl: '', en: '' });
    expect(readiness.missing).toEqual(['name', 'street', 'zip', 'city', 'taxId', 'numbering']);
  });

  it('requires login', async () => {
    expect((await new TestClient(ctx.app).get('/api/company')).statusCode).toBe(401);
  });

  it('can be edited by every user and normalizes identifiers', async () => {
    const res = await ctx.user.put('/api/company', COMPLETE_COMPANY);
    expect(res.statusCode).toBe(200);
    expect(res.json().profile).toMatchObject({
      name: 'Bau & Renovierung Góralewicz',
      countryCode: 'DE',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
      introTexts: { de: 'Sehr geehrte Damen und Herren,', pl: 'Szanowni Państwo,', en: '' },
    });
    // Only the admin-owned number range is still missing.
    expect(res.json().readiness.missing).toEqual(['numbering']);
    expect((await ctx.admin.get('/api/company')).json().profile.closingTexts.en).toBe('Thank you!');
  });

  it('reports invalid fields with codes for the form', async () => {
    const res = await ctx.user.put('/api/company', {
      ...COMPLETE_COMPANY,
      iban: 'DE00 0000 0000 0000 0000 00',
      bic: 'XX',
      email: 'nope',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'INVALID_IBAN',
      fields: { iban: 'INVALID_IBAN', bic: 'INVALID_BIC', email: 'INVALID_EMAIL' },
    });
  });

  it('rejects VAT rates and tax modes outside v1', async () => {
    for (const change of [{ defaultVatRate: 16 }, { taxMode: 'REVERSE_CHARGE' }]) {
      const res = await ctx.user.put('/api/company', { ...COMPLETE_COMPANY, ...change });
      expect(res.statusCode).toBe(400);
    }
  });

  it('accepts a VAT ID instead of a Steuernummer (FR-COMP-04)', async () => {
    const res = await ctx.user.put('/api/company', {
      ...COMPLETE_COMPANY,
      taxNumber: '',
      vatId: 'de 123 456 789',
    });
    expect(res.json().profile.vatId).toBe('DE123456789');
    expect(res.json().readiness.missing).toEqual(['numbering']);
  });
});
