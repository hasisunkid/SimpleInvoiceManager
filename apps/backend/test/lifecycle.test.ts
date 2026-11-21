import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@sim/domain';
import { businessToday } from '../src/time.js';
import { createTestApp, type TestApp } from './helpers/setup.js';
import { COMPLETE_COMPANY } from './helpers/fixtures.js';

let ctx: TestApp;
let customerId: number;
const today = businessToday();

beforeAll(async () => {
  ctx = await createTestApp('lifecycle');
  await ctx.user.put('/api/company', COMPLETE_COMPANY);
  await ctx.admin.put('/api/settings/numbering', {
    prefix: '',
    minDigits: 0,
    nextValue: 99,
    resetYearly: false,
  });
  customerId = (
    await ctx.user.post('/api/customers', {
      type: 'PRIVATE',
      contactPerson: 'Anna Illing',
      street: 'Gartenweg 7',
      zip: '12345',
      city: 'Musterstadt',
    })
  ).json().id;
});
afterAll(async () => ctx?.close());

/** Creates and finalizes an invoice; returns the detail (status OPEN). */
async function openInvoice(cents: number, invoiceDate = today, finalize = true) {
  const created = (await ctx.user.post('/api/invoices', { customerId })).json();
  const saved = (
    await ctx.user.put(`/api/invoices/${created.id}`, {
      version: created.version,
      customerId,
      documentLanguage: 'de',
      invoiceDate,
      serviceDateFrom: invoiceDate,
      serviceDateTo: null,
      paymentTermDays: 30,
      siteAddress: '',
      subject: '',
      introText: '',
      closingText: '',
      positions: [
        {
          type: 'WORK',
          description: 'Arbeit',
          quantityMilli: 1000,
          unitCode: 'LS',
          unitPriceCents: cents,
          vatRate: 0,
        },
      ],
    })
  ).json();
  if (!finalize) return saved;
  const res = await ctx.user.post(`/api/invoices/${saved.id}/finalize`, { version: saved.version });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

describe('status changes (FR-INV-13, FR-INV-14, TR-02)', () => {
  it('marks as paid (default today) and can undo it', async () => {
    const invoice = await openInvoice(10_000);
    const paid = await ctx.user.post(`/api/invoices/${invoice.id}/pay`, {
      version: invoice.version,
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json()).toMatchObject({ status: 'PAID', paidAt: today, number: invoice.number });

    const undone = await ctx.user.post(`/api/invoices/${invoice.id}/unpay`, {
      version: paid.json().version,
    });
    expect(undone.json()).toMatchObject({ status: 'OPEN', paidAt: null });
  });

  it('accepts a payment date between invoice date and today only', async () => {
    const invoice = await openInvoice(1000, addDays(today, -10));
    for (const paidAt of [addDays(today, 1), addDays(today, -11), '2024-02-30']) {
      const res = await ctx.user.post(`/api/invoices/${invoice.id}/pay`, {
        version: invoice.version,
        paidAt,
      });
      expect(res.statusCode, paidAt).toBe(400);
    }
    const ok = await ctx.user.post(`/api/invoices/${invoice.id}/pay`, {
      version: invoice.version,
      paidAt: addDays(today, -3),
    });
    expect(ok.json().paidAt).toBe(addDays(today, -3));
  });

  it('cancels open invoices with a reason – also as a normal user (D7) – keeping the number', async () => {
    const invoice = await openInvoice(2000);
    const noReason = await ctx.user.post(`/api/invoices/${invoice.id}/cancel`, {
      version: invoice.version,
      reason: '   ',
    });
    expect(noReason.json().error).toBe('CANCEL_REASON_REQUIRED');
    const res = await ctx.user.post(`/api/invoices/${invoice.id}/cancel`, {
      version: invoice.version,
      reason: 'Falscher Betrag',
    });
    expect(res.json()).toMatchObject({
      status: 'CANCELLED',
      number: invoice.number,
      cancelReason: 'Falscher Betrag',
    });
  });

  it('refuses every transition that is not in the diagram', async () => {
    const draft = await openInvoice(100, today, false);
    const cancelled = await openInvoice(100);
    const c = (
      await ctx.user.post(`/api/invoices/${cancelled.id}/cancel`, {
        version: cancelled.version,
        reason: 'Test',
      })
    ).json();
    const paid = await openInvoice(100);
    const p = (
      await ctx.user.post(`/api/invoices/${paid.id}/pay`, { version: paid.version })
    ).json();

    const forbidden: [number, number, string, object][] = [
      [draft.id, draft.version, 'pay', {}],
      [draft.id, draft.version, 'cancel', { reason: 'x' }],
      [draft.id, draft.version, 'unpay', {}],
      [c.id, c.version, 'pay', {}],
      [c.id, c.version, 'unpay', {}],
      [c.id, c.version, 'cancel', { reason: 'x' }],
      [p.id, p.version, 'pay', {}],
      // A paid invoice must be set back to open before it can be cancelled.
      [p.id, p.version, 'cancel', { reason: 'x' }],
    ];
    for (const [id, version, action, extra] of forbidden) {
      const res = await ctx.user.post(`/api/invoices/${id}/${action}`, { version, ...extra });
      expect(res.statusCode, `${action} on ${id}`).toBe(409);
      expect(res.json().error).toBe('INVALID_STATUS_CHANGE');
    }
    // Finalized invoices stay read-only in every status.
    for (const id of [c.id, p.id]) {
      expect((await ctx.user.request('DELETE', `/api/invoices/${id}`)).statusCode).toBe(409);
    }
  });

  it('detects stale versions', async () => {
    const invoice = await openInvoice(100);
    const res = await ctx.user.post(`/api/invoices/${invoice.id}/pay`, {
      version: invoice.version - 1,
    });
    expect(res.json().error).toBe('INVOICE_CHANGED');
  });

  it('logs every status change with user, time and note', async () => {
    const invoice = await openInvoice(100);
    const paid = (
      await ctx.user.post(`/api/invoices/${invoice.id}/pay`, { version: invoice.version })
    ).json();
    const open = (
      await ctx.admin.post(`/api/invoices/${invoice.id}/unpay`, { version: paid.version })
    ).json();
    await ctx.admin.post(`/api/invoices/${invoice.id}/cancel`, {
      version: open.version,
      reason: 'Doppelt erstellt',
    });
    const history = (await ctx.user.get(`/api/invoices/${invoice.id}/history`)).json();
    expect(
      history.map((h: Record<string, unknown>) => [h.fromStatus, h.toStatus, h.userName, h.note]),
    ).toEqual([
      [null, 'DRAFT', 'Worker', null],
      ['DRAFT', 'OPEN', 'Worker', null],
      ['OPEN', 'PAID', 'Worker', today],
      ['PAID', 'OPEN', 'Administrator', null],
      ['OPEN', 'CANCELLED', 'Administrator', 'Doppelt erstellt'],
    ]);
  });
});

describe('overview (FR-INV-20, FR-INV-21)', () => {
  let ids: Record<string, number>;

  beforeAll(async () => {
    // Fresh numbers to make the sort test independent of the tests above.
    await ctx.admin.put('/api/settings/numbering', {
      prefix: '',
      minDigits: 0,
      nextValue: 998,
      resetYearly: false,
    });
    const overdue = await openInvoice(50_000, addDays(today, -40)); // due 10 days ago → 998
    const open = await openInvoice(7_000); // 999
    const toPay = await openInvoice(30_000); // 1000
    await ctx.user.post(`/api/invoices/${toPay.id}/pay`, { version: toPay.version });
    ids = { overdue: overdue.id, open: open.id, paid: toPay.id };
  });

  it('counts drafts, open, overdue and paid this year', async () => {
    const summary = (await ctx.user.get('/api/invoices/summary')).json();
    const list = async (status: string) =>
      (await ctx.user.get(`/api/invoices?status=${status}&limit=200`)).json();
    const sum = (items: { grossCents: number }[]) => items.reduce((s, i) => s + i.grossCents, 0);

    const drafts = await list('DRAFT');
    const open = await list('OPEN');
    const overdue = await list('OVERDUE');
    expect(summary.drafts).toBe(drafts.total);
    expect(summary.open).toEqual({ count: open.total, grossCents: sum(open.items) });
    expect(summary.overdue).toEqual({ count: overdue.total, grossCents: sum(overdue.items) });
    expect(overdue.items.map((i: { id: number }) => i.id)).toContain(ids.overdue);
    expect(overdue.items.every((i: { overdue: boolean }) => i.overdue)).toBe(true);
    expect(summary.paidThisYear.count).toBeGreaterThanOrEqual(1);
    expect(summary.paidThisYear.grossCents).toBeGreaterThanOrEqual(30_000);
  });

  it('searches by number and customer name and filters by date range', async () => {
    const search = async (query: string) =>
      (await ctx.user.get(`/api/invoices?${query}`)).json().items.map((i: { id: number }) => i.id);
    expect(await search('q=1000')).toEqual([ids.paid]);
    expect((await search('q=illing')).length).toBeGreaterThan(3);
    expect(await search('q=unbekannt')).toEqual([]);
    const from = addDays(today, -41);
    const to = addDays(today, -39);
    expect(await search(`from=${from}&to=${to}`)).toEqual([ids.overdue]);
    expect(await search(`customerId=${customerId}&status=PAID&q=1000`)).toEqual([ids.paid]);
  });

  it('sorts by number (naturally), amount and date', async () => {
    const numbers = async (query: string) =>
      (await ctx.user.get(`/api/invoices?${query}&limit=200`))
        .json()
        .items.map((i: { number: string | null }) => i.number)
        .filter((n: string | null) => n !== null && Number(n) >= 998);
    expect(await numbers('sort=number&order=asc')).toEqual(['998', '999', '1000']);
    expect(await numbers('sort=number&order=desc')).toEqual(['1000', '999', '998']);

    const amounts = (await ctx.user.get('/api/invoices?sort=amount&order=desc&limit=200'))
      .json()
      .items.map((i: { grossCents: number }) => i.grossCents);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    const dates = (await ctx.user.get('/api/invoices?sort=date&order=asc&limit=200'))
      .json()
      .items.map((i: { invoiceDate: string }) => i.invoiceDate);
    expect(dates).toEqual([...dates].sort());
  });

  it('rejects unknown filter values', async () => {
    expect((await ctx.user.get('/api/invoices?status=LATE')).statusCode).toBe(400);
    expect((await ctx.user.get('/api/invoices?sort=customer')).statusCode).toBe(400);
    expect((await ctx.user.get('/api/invoices?from=2024-13-01')).statusCode).toBe(400);
  });
});

describe('performance (NFR-PERF-01: < 500 ms with 5 000 invoices)', () => {
  it('lists, searches and summarizes quickly', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => {
      const date = addDays(today, -(i % 700));
      return {
        number: `P${i}`,
        status: ['OPEN', 'PAID', 'CANCELLED', 'DRAFT'][i % 4],
        customer_id: customerId,
        invoice_date: date,
        service_date_from: date,
        payment_term_days: 30,
        due_date: addDays(date, 30),
        site_address: '',
        subject: '',
        intro_text: '',
        closing_text: '',
        tax_mode: 'REGULAR',
        gross_total_cents: 1000 + i,
        paid_at: i % 4 === 1 ? date : null,
        buyer_snapshot: JSON.stringify({ name: `Kunde ${i % 300}` }),
      };
    });
    for (let i = 0; i < rows.length; i += 1000) {
      await ctx.t.db('invoice').insert(rows.slice(i, i + 1000));
    }
    const timings: Record<string, number> = {};
    for (const query of [
      'invoices?limit=50',
      'invoices?status=OVERDUE&limit=50',
      'invoices?q=kunde%2012&limit=50',
      'invoices?sort=amount&order=desc&limit=50',
      'invoices/summary',
    ]) {
      const started = performance.now();
      expect((await ctx.user.get(`/api/${query}`)).statusCode).toBe(200);
      timings[query] = performance.now() - started;
    }
    for (const [query, ms] of Object.entries(timings)) expect(ms, query).toBeLessThan(500);
  });
});
