import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { businessToday } from '../src/time.js';
import { createTestApp, type TestApp } from './helpers/setup.js';
import { COMPLETE_COMPANY } from './helpers/fixtures.js';
import { TestClient } from './helpers/client.js';

let ctx: TestApp;
let illing: { id: number };
let omicron: { id: number };

beforeAll(async () => {
  ctx = await createTestApp('invoices');
  expect((await ctx.user.put('/api/company', COMPLETE_COMPANY)).statusCode).toBe(200);
  illing = (
    await ctx.user.post('/api/customers', {
      type: 'PRIVATE',
      contactPerson: 'Anna Illing',
      street: 'Gartenweg 7',
      zip: '12345',
      city: 'Musterstadt',
    })
  ).json();
  omicron = (
    await ctx.user.post('/api/customers', {
      type: 'BUSINESS',
      companyName: 'Omicronservice GmbH',
      contactPerson: 'Herr Karaca',
      street: 'Industriestraße 5',
      zip: '54321',
      city: 'Beispielstadt',
      invoiceLanguage: 'pl',
    })
  ).json();
});
afterAll(async () => ctx?.close());

const work = (cents: number, description = 'Arbeit pauschal') => ({
  type: 'WORK',
  description,
  quantityMilli: 1000,
  unitCode: 'LS',
  unitPriceCents: cents,
  vatRate: 19,
});
const material = (cents: number) => ({ ...work(cents, 'Material pauschal'), type: 'MATERIAL' });

async function newDraft(customerId: number | null = null) {
  const res = await ctx.user.post('/api/invoices', customerId ? { customerId } : {});
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

/** Builds a PUT body from a detail response. */
function body(invoice: Record<string, unknown>, changes: Record<string, unknown> = {}) {
  const keys = [
    'version',
    'customerId',
    'documentLanguage',
    'invoiceDate',
    'serviceDateFrom',
    'serviceDateTo',
    'paymentTermDays',
    'siteAddress',
    'subject',
    'introText',
    'closingText',
  ];
  const base = Object.fromEntries(keys.map((k) => [k, invoice[k]]));
  const positions = (invoice.positions as Record<string, unknown>[]).map(
    ({ lineTotalCents: _l, vatCategory: _v, ...p }) => p,
  );
  return { ...base, positions, ...changes };
}

describe('new drafts (FR-INV-01, FR-INV-02)', () => {
  it('starts with today, the default payment term and the customer language and texts', async () => {
    const draft = await newDraft(omicron.id);
    const today = businessToday();
    expect(draft).toMatchObject({
      status: 'DRAFT',
      number: null,
      version: 1,
      customerId: omicron.id,
      documentLanguage: 'pl',
      invoiceDate: today,
      serviceDateFrom: today,
      serviceDateTo: null,
      paymentTermDays: 30,
      closingText: 'Dziękujemy!',
      positions: [],
      customer: { displayName: 'Omicronservice GmbH' },
    });
    expect(draft.dueDate > today).toBe(true);
  });

  it('can start without a customer and reports what is missing (FR-INV-07)', async () => {
    const draft = await newDraft();
    expect(draft.customer).toBeNull();
    expect(draft.finalizeProblems).toEqual([
      'CUSTOMER_MISSING',
      'NO_POSITIONS',
      'NUMBERING_NOT_CONFIGURED',
    ]);
  });

  it('refuses archived or unknown customers', async () => {
    const { id } = (
      await ctx.user.post('/api/customers', { type: 'PRIVATE', contactPerson: 'Old Customer' })
    ).json();
    await ctx.user.put(`/api/customers/${id}/archived`, { archived: true });
    const archived = await ctx.user.post('/api/invoices', { customerId: id });
    expect(archived.statusCode).toBe(400);
    expect(archived.json().error).toBe('CUSTOMER_ARCHIVED');
    expect((await ctx.user.post('/api/invoices', { customerId: 99999 })).json().error).toBe(
      'CUSTOMER_NOT_FOUND',
    );
  });
});

describe('editing and calculation (FR-INV-03..06)', () => {
  it('saves positions and calculates like reference invoice 104 (at 19 %)', async () => {
    const draft = await newDraft(illing.id);
    const res = await ctx.user.put(
      `/api/invoices/${draft.id}`,
      body(draft, {
        subject: 'Renovierung nach Wasserschaden – Putzarbeiten – Trockenbau – Streichen',
        siteAddress: 'Baustelle Gartenweg 7\n12345 Musterstadt',
        serviceDateFrom: '2024-05-13',
        serviceDateTo: '2024-05-17',
        invoiceDate: '2024-05-22',
        positions: [work(175_500), material(64_000)],
      }),
    );
    expect(res.statusCode, res.body).toBe(200);
    const saved = res.json();
    expect(saved.version).toBe(2);
    expect(saved.dueDate).toBe('2024-06-21');
    expect(saved.positions.map((p: { lineTotalCents: number }) => p.lineTotalCents)).toEqual([
      175_500, 64_000,
    ]);
    expect(saved.totals).toMatchObject({
      netCents: 239_500,
      vatCents: 45_505,
      grossCents: 285_005,
      sections: { WORK: { netCents: 175_500 }, MATERIAL: { netCents: 64_000 } },
      labourCostInclVatCents: 208_845,
    });
    // Everything for § 14 is there except the number range (admin, not configured here).
    expect(saved.finalizeProblems).toEqual(['NUMBERING_NOT_CONFIGURED']);
    // The stored totals feed the list.
    const list = (await ctx.user.get(`/api/invoices?customerId=${illing.id}`)).json();
    expect(list.items[0]).toMatchObject({
      id: draft.id,
      grossCents: 285_005,
      customerName: 'Anna Illing',
    });
  });

  it('keeps the order of positions (FR-INV-05)', async () => {
    const draft = await newDraft(illing.id);
    const positions = [work(100, 'C'), work(200, 'A'), material(300)];
    const saved = (
      await ctx.user.put(`/api/invoices/${draft.id}`, body(draft, { positions }))
    ).json();
    expect(saved.positions.map((p: { description: string }) => p.description)).toEqual([
      'C',
      'A',
      'Material pauschal',
    ]);
  });

  it('uses quantities with three decimals and half-up rounding', async () => {
    const draft = await newDraft(illing.id);
    const saved = (
      await ctx.user.put(
        `/api/invoices/${draft.id}`,
        body(draft, {
          positions: [{ ...work(4800, 'Stundenlohn'), quantityMilli: 2_335, unitCode: 'HUR' }],
        }),
      )
    ).json();
    // 2,335 h × 48,00 € = 112,08 €
    expect(saved.positions[0].lineTotalCents).toBe(11_208);
  });

  it('follows the company tax mode for drafts (§ 19 UStG)', async () => {
    const draft = await newDraft(illing.id);
    await ctx.user.put('/api/company', { ...COMPLETE_COMPANY, taxMode: 'SMALL_BUSINESS_19' });
    const saved = (
      await ctx.user.put(`/api/invoices/${draft.id}`, body(draft, { positions: [work(8000)] }))
    ).json();
    expect(saved).toMatchObject({ taxMode: 'SMALL_BUSINESS_19' });
    expect(saved.totals).toMatchObject({ netCents: 8000, vatCents: 0, grossCents: 8000 });
    expect(saved.positions[0].vatCategory).toBe('E');
    await ctx.user.put('/api/company', COMPLETE_COMPANY);
  });

  it('validates the input', async () => {
    const draft = await newDraft(illing.id);
    const cases: Record<string, unknown>[] = [
      { positions: [{ ...work(100), quantityMilli: 0 }] },
      { positions: [{ ...work(100), unitPriceCents: -1 }] },
      { positions: [{ ...work(100), vatRate: 16 }] },
      { positions: [{ ...work(100), unitCode: 'h' }] },
      { positions: Array.from({ length: 201 }, () => work(1)) },
      { invoiceDate: '2024-02-30' },
      { invoiceDate: '22.05.2024' },
      { paymentTermDays: 400 },
    ];
    for (const change of cases) {
      const res = await ctx.user.put(`/api/invoices/${draft.id}`, body(draft, change));
      expect(res.statusCode, JSON.stringify(change).slice(0, 80)).toBe(400);
    }
  });

  it('rejects switching to an archived customer', async () => {
    const draft = await newDraft(illing.id);
    const { id } = (
      await ctx.user.post('/api/customers', { type: 'PRIVATE', contactPerson: 'Gone Customer' })
    ).json();
    await ctx.user.put(`/api/customers/${id}/archived`, { archived: true });
    const res = await ctx.user.put(`/api/invoices/${draft.id}`, body(draft, { customerId: id }));
    expect(res.json().error).toBe('CUSTOMER_ARCHIVED');
  });
});

describe('auto-save safety', () => {
  it('rejects a stale save from another device (optimistic locking)', async () => {
    const draft = await newDraft(illing.id);
    const phone = await ctx.user.put(
      `/api/invoices/${draft.id}`,
      body(draft, { subject: 'Phone' }),
    );
    expect(phone.statusCode).toBe(200);
    const laptop = await ctx.admin.put(
      `/api/invoices/${draft.id}`,
      body(draft, { subject: 'Laptop' }),
    );
    expect(laptop.statusCode).toBe(409);
    expect(laptop.json().error).toBe('INVOICE_CHANGED');
    expect((await ctx.user.get(`/api/invoices/${draft.id}`)).json().subject).toBe('Phone');
  });

  it('serializes parallel saves: exactly one wins', async () => {
    const draft = await newDraft(illing.id);
    const results = await Promise.all(
      ['A', 'B', 'C'].map((subject) =>
        ctx.user.put(`/api/invoices/${draft.id}`, body(draft, { subject })),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
  });
});

describe('finalized invoices are read-only (FR-INV-13, TR-02)', () => {
  it('cannot be edited or deleted', async () => {
    const draft = await newDraft(illing.id);
    // Finalizing arrives in M5; simulate it on the database level.
    await ctx.t.db('invoice').where({ id: draft.id }).update({ status: 'OPEN', number: '104' });
    const edit = await ctx.user.put(`/api/invoices/${draft.id}`, body(draft, { subject: 'x' }));
    expect(edit.statusCode).toBe(409);
    expect(edit.json().error).toBe('INVOICE_NOT_EDITABLE');
    const del = await ctx.user.request('DELETE', `/api/invoices/${draft.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe('INVOICE_NOT_DELETABLE');
    // A customer with invoices can no longer be deleted (FR-CUST-04, real foreign key).
    const customerDelete = await ctx.user.request('DELETE', `/api/customers/${illing.id}`);
    expect(customerDelete.json().error).toBe('CUSTOMER_HAS_INVOICES');
  });

  it('shows the open total per customer (FR-CUST-03)', async () => {
    const list = (await ctx.user.get(`/api/invoices?customerId=${illing.id}`)).json();
    const open = list.items.filter((i: { status: string }) => i.status === 'OPEN');
    expect(open.length).toBeGreaterThan(0);
    expect(list.openTotalCents).toBe(
      open.reduce((s: number, i: { grossCents: number }) => s + i.grossCents, 0),
    );
  });
});

describe('drafts: delete and copy (FR-INV-08, FR-INV-13)', () => {
  it('deletes drafts', async () => {
    const draft = await newDraft(illing.id);
    expect((await ctx.user.request('DELETE', `/api/invoices/${draft.id}`)).statusCode).toBe(204);
    expect((await ctx.user.get(`/api/invoices/${draft.id}`)).statusCode).toBe(404);
  });

  it('copies any invoice into a new draft with new dates and no number', async () => {
    const draft = await newDraft(omicron.id);
    const saved = (
      await ctx.user.put(
        `/api/invoices/${draft.id}`,
        body(draft, {
          invoiceDate: '2024-05-22',
          serviceDateFrom: '2024-05-13',
          subject: 'Renovierung',
          positions: [work(175_500), material(64_000)],
        }),
      )
    ).json();
    await ctx.t
      .db('invoice')
      .where({ id: draft.id })
      .update({ status: 'CANCELLED', number: '105' });
    const res = await ctx.user.post(`/api/invoices/${draft.id}/copy`);
    expect(res.statusCode).toBe(201);
    const copy = res.json();
    expect(copy).toMatchObject({
      status: 'DRAFT',
      number: null,
      customerId: omicron.id,
      subject: 'Renovierung',
      documentLanguage: 'pl',
      invoiceDate: businessToday(),
      serviceDateFrom: businessToday(),
      totals: { grossCents: saved.totals.grossCents },
    });
    expect(copy.id).not.toBe(draft.id);
    expect(copy.positions).toHaveLength(2);
  });
});

describe('access', () => {
  it('requires login and records who created and changed an invoice (FR-AUTH-08)', async () => {
    expect((await new TestClient(ctx.app).get('/api/invoices')).statusCode).toBe(401);
    const draft = await newDraft(illing.id);
    await ctx.admin.put(`/api/invoices/${draft.id}`, body(draft, { subject: 'by admin' }));
    const row = await ctx.t
      .db('invoice as i')
      .join('app_user as c', 'c.id', 'i.created_by')
      .join('app_user as u', 'u.id', 'i.updated_by')
      .where('i.id', draft.id)
      .first('c.username as creator', 'u.username as editor');
    expect(row).toEqual({ creator: 'worker', editor: 'admin' });
    const history = await ctx.t.db('invoice_status_history').where({ invoice_id: draft.id });
    expect(history).toMatchObject([{ from_status: null, to_status: 'DRAFT' }]);
  });

  it('answers 404 for unknown invoices', async () => {
    expect((await ctx.user.get('/api/invoices/999999')).statusCode).toBe(404);
    expect((await ctx.user.post('/api/invoices/999999/copy')).statusCode).toBe(404);
  });
});
