import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/setup.js';
import { TestClient } from './helpers/client.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp('customers');
});
afterAll(async () => ctx?.close());

const omicron = {
  type: 'BUSINESS',
  companyName: 'Omicronservice GmbH',
  contactPerson: 'Herr Karaca',
  street: 'Industriestraße 5',
  zip: '54321',
  city: 'Beispielstadt',
  vatId: 'de 123 456 789',
};

async function create(body: object) {
  const res = await ctx.user.post('/api/customers', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

async function search(query: string) {
  const res = await ctx.user.get(`/api/customers?${query}`);
  expect(res.statusCode).toBe(200);
  return res.json() as { items: { displayName: string }[]; total: number };
}

describe('customer CRUD (FR-CUST-01, FR-CUST-05)', () => {
  it('requires login', async () => {
    expect((await new TestClient(ctx.app).get('/api/customers')).statusCode).toBe(401);
  });

  it('creates a full business customer and normalizes the VAT ID', async () => {
    const customer = await create(omicron);
    expect(customer).toMatchObject({
      displayName: 'Omicronservice GmbH',
      contactPerson: 'Herr Karaca',
      vatId: 'DE123456789',
      countryCode: 'DE',
      invoiceLanguage: 'de',
      archived: false,
    });
  });

  it('quick-creates a customer with only a name (FR-CUST-05)', async () => {
    const customer = await create({ type: 'PRIVATE', contactPerson: 'Anna Illing' });
    expect(customer).toMatchObject({ displayName: 'Anna Illing', street: '', notes: '' });
  });

  it('reports missing names and invalid fields', async () => {
    const res = await ctx.user.post('/api/customers', {
      type: 'BUSINESS',
      contactPerson: 'only a person',
      email: 'broken',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'NAME_REQUIRED',
      fields: { companyName: 'NAME_REQUIRED', email: 'INVALID_EMAIL' },
    });
  });

  it('updates a customer', async () => {
    const { id } = await create({ type: 'PRIVATE', contactPerson: 'Piotr Nowak' });
    const res = await ctx.user.put(`/api/customers/${id}`, {
      type: 'PRIVATE',
      contactPerson: 'Piotr Nowak',
      city: 'Musterstadt',
      invoiceLanguage: 'pl',
      notes: 'Rechnung bitte auf Polnisch',
    });
    expect(res.json()).toMatchObject({ city: 'Musterstadt', invoiceLanguage: 'pl' });
    expect((await ctx.user.get(`/api/customers/${id}`)).json().notes).toBe(
      'Rechnung bitte auf Polnisch',
    );
    expect((await ctx.user.get('/api/customers/999999')).statusCode).toBe(404);
  });
});

describe('customer search (FR-CUST-02)', () => {
  beforeAll(async () => {
    await create({ type: 'PRIVATE', contactPerson: 'Ewa Góralewicz', city: 'Łódź' });
    await create({ type: 'BUSINESS', companyName: '100% Bau_GmbH', city: 'Köln' });
  });

  it('finds by company, contact person and city, ignoring case and accents', async () => {
    expect((await search('q=omicron')).items.map((c) => c.displayName)).toEqual([
      'Omicronservice GmbH',
    ]);
    expect((await search('q=karaca')).total).toBe(1);
    expect((await search('q=BEISPIEL')).total).toBe(1);
    expect((await search('q=goralewicz')).items[0]?.displayName).toBe('Ewa Góralewicz');
    expect((await search(`q=${encodeURIComponent('lodz')}`)).total).toBe(1);
  });

  it('requires every word to match', async () => {
    expect((await search('q=ewa%20lodz')).total).toBe(1);
    expect((await search('q=ewa%20koln')).total).toBe(0);
  });

  it('treats wildcards literally', async () => {
    expect((await search('q=100%25')).items.map((c) => c.displayName)).toEqual(['100% Bau_GmbH']);
    expect((await search('q=u_G')).total).toBe(1);
    expect((await search('q=%25%25')).total).toBe(0);
  });

  it('ignores one-character queries and sorts by name', async () => {
    const all = await search('q=x');
    expect(all.total).toBeGreaterThanOrEqual(5);
    const names = all.items.map((c) => c.displayName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')));
  });

  it('pages results', async () => {
    const page = await search('limit=2&offset=1');
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThanOrEqual(5);
  });
});

describe('archive and delete (FR-CUST-04)', () => {
  it('hides archived customers from the selection but keeps them', async () => {
    const { id } = await create({ type: 'PRIVATE', contactPerson: 'Archiv Kunde' });
    const res = await ctx.user.put(`/api/customers/${id}/archived`, { archived: true });
    expect(res.json().archived).toBe(true);
    expect((await search('q=archiv')).total).toBe(0);
    expect((await search('q=archiv&includeArchived=true')).total).toBe(1);
    await ctx.user.put(`/api/customers/${id}/archived`, { archived: false });
    expect((await search('q=archiv')).total).toBe(1);
  });

  it('deletes customers without invoices', async () => {
    const { id } = await create({ type: 'PRIVATE', contactPerson: 'Delete Me' });
    expect((await ctx.user.request('DELETE', `/api/customers/${id}`)).statusCode).toBe(204);
    expect((await ctx.user.get(`/api/customers/${id}`)).statusCode).toBe(404);
    expect((await ctx.user.request('DELETE', `/api/customers/${id}`)).statusCode).toBe(404);
  });

  it('refuses to delete customers that are referenced (invoices, M4)', async () => {
    // Stand-in for the invoice table: same RESTRICT foreign key.
    await ctx.t.db.schema.createTable('fk_probe', (t) => {
      t.increments('id');
      t.integer('customer_id').unsigned().references('id').inTable('customer').onDelete('RESTRICT');
    });
    const { id } = await create({ type: 'PRIVATE', contactPerson: 'Has Invoices' });
    await ctx.t.db('fk_probe').insert({ customer_id: id });
    const res = await ctx.user.request('DELETE', `/api/customers/${id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('CUSTOMER_HAS_INVOICES');
    await ctx.t.db.schema.dropTable('fk_probe');
  });
});

describe('search performance (FR-CUST-02: ≤ 300 ms with 5 000 customers)', () => {
  it('answers within the budget', async () => {
    const cities = ['Musterstadt', 'Beispielstadt', 'Köln', 'Łódź', 'Berlin'];
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      type: i % 3 === 0 ? 'BUSINESS' : 'PRIVATE',
      company_name: i % 3 === 0 ? `Firma ${i} GmbH` : '',
      contact_person: `Person Nummer ${i}`,
      city: cities[i % cities.length],
      notes: '',
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      await ctx.t.db('customer').insert(rows.slice(i, i + 1000));
    }
    const timings: number[] = [];
    for (const q of ['nummer 4711', 'lodz', 'firma 12', 'xyz-none', 'person']) {
      const started = performance.now();
      const res = await ctx.user.get(`/api/customers?q=${encodeURIComponent(q)}&limit=50`);
      timings.push(performance.now() - started);
      expect(res.statusCode).toBe(200);
    }
    expect(Math.max(...timings)).toBeLessThan(300);
  });
});
