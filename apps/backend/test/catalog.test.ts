import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoData } from '../src/seed/demo.js';
import { createTestApp, type TestApp } from './helpers/setup.js';
import { createTestDatabase } from './helpers/db.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp('catalog');
});
afterAll(async () => ctx?.close());

const hourly = {
  type: 'WORK',
  title: 'Stundenlohn Geselle',
  description: 'Arbeitszeit Geselle',
  unitCode: 'HUR',
  unitPriceCents: 4800,
  vatRate: 19,
  active: true,
};

async function create(body: object) {
  const res = await ctx.user.post('/api/catalog', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

describe('catalogue (FR-CAT-01..04)', () => {
  it('creates items for every user', async () => {
    const item = await create(hourly);
    expect(item).toMatchObject({ ...hourly, id: expect.any(Number) });
  });

  it('validates type, unit, price and VAT rate', async () => {
    for (const change of [
      { type: 'TOOLS' },
      { unitCode: 'h' },
      { unitPriceCents: -1 },
      { unitPriceCents: 12.5 },
      { vatRate: 16 },
      { title: '' },
    ]) {
      const res = await ctx.user.post('/api/catalog', { ...hourly, ...change });
      expect(res.statusCode, JSON.stringify(change)).toBe(400);
    }
    const blank = await ctx.user.post('/api/catalog', { ...hourly, title: '   ' });
    expect(blank.json().error).toBe('TITLE_REQUIRED');
  });

  it('searches title and description, filters by type and hides inactive items', async () => {
    await create({
      ...hourly,
      type: 'MATERIAL',
      title: 'Gipskartonplatte',
      description: 'Bauplatte 12,5 mm',
      unitCode: 'H87',
    });
    await create({ ...hourly, title: 'Alter Satz', active: false });

    const titles = async (query: string) =>
      ((await ctx.user.get(`/api/catalog?${query}`)).json() as { title: string }[]).map(
        (i) => i.title,
      );
    expect(await titles('q=bauplatte')).toEqual(['Gipskartonplatte']);
    expect(await titles('type=MATERIAL')).toEqual(['Gipskartonplatte']);
    expect(await titles('')).not.toContain('Alter Satz');
    expect(await titles('includeInactive=true')).toContain('Alter Satz');
    // Work before material.
    expect(await titles('')).toEqual(['Stundenlohn Geselle', 'Gipskartonplatte']);
  });

  it('updates and deletes items', async () => {
    const { id } = await create({ ...hourly, title: 'Temporär' });
    const res = await ctx.user.put(`/api/catalog/${id}`, { ...hourly, unitPriceCents: 5200 });
    expect(res.json().unitPriceCents).toBe(5200);
    expect((await ctx.user.request('DELETE', `/api/catalog/${id}`)).statusCode).toBe(204);
    expect((await ctx.user.get(`/api/catalog/${id}`)).statusCode).toBe(404);
  });
});

describe('demo data (AR-17)', () => {
  it('fills an empty installation once and never touches real data', async () => {
    const t = await createTestDatabase('seed');
    try {
      expect(await seedDemoData(t.db)).toBe(true);
      const company = await t.db('company_profile').first<{ name: string }>();
      expect(company?.name).toBe('Bau & Renovierung Góralewicz');
      const numbering = await t.db('number_sequence').first<{ next_value: number }>();
      expect(numbering?.next_value).toBe(104);
      expect(await t.db('customer').count({ n: '*' }).first()).toEqual({ n: 3 });
      expect(await seedDemoData(t.db)).toBe(false);
    } finally {
      await t.drop();
    }
  });

  it('keeps an existing company profile', async () => {
    await ctx.t.db('company_profile').update({ name: 'Echte Firma' });
    await ctx.t.db('catalog_item').delete();
    await ctx.t.db('customer').delete();
    expect(await seedDemoData(ctx.t.db)).toBe(true);
    expect((await ctx.t.db('company_profile').first<{ name: string }>())?.name).toBe('Echte Firma');
  });
});
