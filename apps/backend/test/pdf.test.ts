import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { InvoiceRenderer } from '../src/pdf/types.js';
import { createTestApp, pdfText, type TestApp } from './helpers/setup.js';
import { COMPLETE_COMPANY } from './helpers/fixtures.js';
import { TestClient } from './helpers/client.js';

/**
 * TR-04: the reference scenarios of Appendix A, adapted to the v1 tax variants, are finalized
 * through the real API; the stored PDFs are checked by text extraction.
 */
let ctx: TestApp;
let illing: number;
let omicron: number;

beforeAll(async () => {
  ctx = await createTestApp('pdf');
  expect((await ctx.user.put('/api/company', COMPLETE_COMPANY)).statusCode).toBe(200);
  await setNextNumber(102);
  illing = (
    await ctx.user.post('/api/customers', {
      type: 'PRIVATE',
      contactPerson: 'Anna Illing',
      street: 'Gartenweg 7',
      zip: '12345',
      city: 'Musterstadt',
    })
  ).json().id;
  omicron = (
    await ctx.user.post('/api/customers', {
      type: 'BUSINESS',
      companyName: 'Omicronservice GmbH',
      contactPerson: 'Herr Karaca',
      street: 'Industriestraße 5',
      zip: '54321',
      city: 'Beispielstadt',
    })
  ).json().id;
});
afterAll(async () => ctx?.close());

async function setNextNumber(nextValue: number) {
  const res = await ctx.admin.put('/api/settings/numbering', {
    prefix: '',
    minDigits: 0,
    nextValue,
    resetYearly: false,
  });
  expect(res.statusCode, res.body).toBe(200);
}

const position = (type: 'WORK' | 'MATERIAL', description: string, cents: number) => ({
  type,
  description,
  quantityMilli: 1000,
  unitCode: 'LS',
  unitPriceCents: cents,
  vatRate: 19,
});

/** Creates a draft, saves the given content and returns the saved detail. */
async function draft(customerId: number, content: Record<string, unknown>) {
  const created = (await ctx.user.post('/api/invoices', { customerId })).json();
  const res = await ctx.user.put(`/api/invoices/${created.id}`, {
    version: created.version,
    customerId,
    documentLanguage: created.documentLanguage,
    invoiceDate: created.invoiceDate,
    serviceDateFrom: created.serviceDateFrom,
    serviceDateTo: null,
    paymentTermDays: 30,
    siteAddress: '',
    subject: '',
    introText: '',
    closingText: 'Wir bedanken uns für den Auftrag.',
    positions: [],
    ...content,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

async function finalize(invoice: { id: number; version: number }) {
  return ctx.user.post(`/api/invoices/${invoice.id}/finalize`, { version: invoice.version });
}

async function download(id: number) {
  const res = await ctx.user.get(`/api/invoices/${id}/pdf`);
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('application/pdf');
  return res;
}

function expectAll(text: string, expected: string[]) {
  for (const part of expected) expect(text, part).toContain(part);
}

describe('reference scenarios (TR-04, Appendix A)', () => {
  it('102 Illing – private customer, one lump sum, 19 % VAT', async () => {
    const saved = await draft(illing, {
      invoiceDate: '2024-03-05',
      serviceDateFrom: '2024-02-28',
      positions: [position('WORK', 'Entsorgung von Gartenabfällen', 8000)],
    });
    const res = await finalize(saved);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'OPEN', number: '102', version: saved.version + 1 });

    const pdf = await download(saved.id);
    expect(pdf.headers['content-disposition']).toContain('RechnungsNr_102_Illing_05.03.2024.pdf');
    const { text, pages } = await pdfText(pdf.rawPayload);
    expect(pages).toBe(1);
    expectAll(text, [
      // seller (§ 14 Abs. 4 Nr. 1, 2)
      'BAU & RENOVIERUNG GÓRALEWICZ',
      'Hauptstraße 1',
      '12345 Musterstadt',
      'St.-Nr. 12/345/67890',
      'IBAN DE89 3704 0044 0532 0130 00',
      // buyer
      'Anna Illing',
      'Gartenweg 7',
      // dates and number (Nr. 3, 4, 6)
      'Rechnung',
      'Datum 05.03.2024',
      'Rechnungsnummer 102',
      'Leistungsdatum 28.02.2024',
      'Zahlungsziel 30 Tage',
      'Fällig am 04.04.2024',
      // quantity and description (Nr. 5), amounts per rate (Nr. 7, 8)
      'Entsorgung von Gartenabfällen',
      '1 pauschal',
      'Zwischensumme 80,00 €',
      'MwSt. 19 % 15,20 €',
      'Gesamt 95,20 €',
      // § 35a for private customers (FR-INV-04)
      'Enthaltene Arbeitskosten inkl. MwSt.: 95,20 €',
      'Mit freundlichen Grüßen',
      'Jan Góralewicz',
      'Seite 1 von 1',
    ]);
    expect(text).not.toContain('ENTWURF');
  });

  it('104 Karaca – business customer, subject, site, work and material sections (19 %)', async () => {
    await setNextNumber(104);
    const saved = await draft(omicron, {
      invoiceDate: '2024-05-22',
      serviceDateFrom: '2024-05-13',
      serviceDateTo: '2024-05-17',
      subject: 'Renovierung nach Wasserschaden – Putzarbeiten – Trockenbau – Streichen',
      siteAddress: 'Industriestraße 5a\n54321 Beispielstadt',
      positions: [
        position('WORK', 'Arbeit pauschal', 175_500),
        position('MATERIAL', 'Material pauschal', 64_000),
      ],
    });
    expect((await finalize(saved)).json().number).toBe('104');

    const pdf = await download(saved.id);
    expect(pdf.headers['content-disposition']).toContain('RechnungsNr_104_Karaca_22.05.2024.pdf');
    const { text } = await pdfText(pdf.rawPayload);
    expectAll(text, [
      'Omicronservice GmbH',
      'Z. Hd. Herr Karaca',
      'Industriestraße 5',
      'Renovierung nach Wasserschaden – Putzarbeiten – Trockenbau – Streichen',
      'Baustelle: Industriestraße 5a, 54321 Beispielstadt',
      'Rechnungsnummer 104',
      'Leistungszeitraum 13.–17.05.2024',
      'Arbeit',
      'Zwischensumme Arbeit 1.755,00 €',
      'Material',
      'Zwischensumme Material 640,00 €',
      'Zwischensumme 2.395,00 €',
      'MwSt. 19 % 455,05 €',
      'Gesamt 2.850,05 €',
    ]);
    // § 35a only for private customers.
    expect(text).not.toContain('Enthaltene Arbeitskosten');
  });

  it('115-1 Karaca – adapted to Kleinunternehmer (§ 19) in Polish with Polish characters', async () => {
    await ctx.user.put('/api/company', { ...COMPLETE_COMPANY, taxMode: 'SMALL_BUSINESS_19' });
    try {
      const saved = await draft(omicron, {
        documentLanguage: 'pl',
        invoiceDate: '2024-11-18',
        serviceDateFrom: '2024-11-11',
        closingText: 'Dziękujemy za zlecenie – część płatności zgodnie z umową.',
        positions: [
          position(
            'MATERIAL',
            'Zaliczka na materiał 50 % (źródło: zamówienie, ąćęłńóśźż)',
            260_000,
          ),
        ],
      });
      expect((await finalize(saved)).json()).toMatchObject({
        number: '105',
        taxMode: 'SMALL_BUSINESS_19',
      });
      const pdf = await download(saved.id);
      expect(decodeURIComponent(pdf.headers['content-disposition'] as string)).toContain(
        'Faktura_105_Karaca_18.11.2024.pdf',
      );
      const { text } = await pdfText(pdf.rawPayload);
      expectAll(text, [
        'Faktura',
        'Numer faktury 105',
        'Data 18.11.2024',
        'Data wykonania usługi 11.11.2024',
        'Termin płatności 30 dni',
        'Do rąk Herr Karaca',
        'ąćęłńóśźż',
        // Polish grouping uses a (non-breaking) space: 2 600,00 € (FR-I18N-03).
        'Razem 2 600,00 €',
        'Zgodnie z § 19 UStG podatek VAT nie jest naliczany.',
        'Dziękujemy za zlecenie – część płatności zgodnie z umową.',
        'Z poważaniem',
        'Strona 1 z 1',
      ]);
      expect(text).not.toMatch(/VAT 19/);
    } finally {
      await ctx.user.put('/api/company', COMPLETE_COMPANY);
    }
  });
});

describe('finalize (FR-INV-11, FR-INV-13, FR-COMP-05)', () => {
  it('stores the PDF once and returns it byte-identical, unaffected by later changes', async () => {
    const saved = await draft(illing, { positions: [position('WORK', 'Fliesen legen', 50_000)] });
    const { number } = (await finalize(saved)).json();
    const first = (await download(saved.id)).rawPayload;
    const row = await ctx.t.db('invoice').where({ id: saved.id }).first();
    expect(createHash('sha256').update(first).digest('hex')).toBe(row.pdf_sha256);

    // Company and customer change afterwards …
    await ctx.user.put('/api/company', { ...COMPLETE_COMPANY, name: 'Neuer Firmenname' });
    await ctx.user.put(`/api/customers/${illing}`, {
      type: 'PRIVATE',
      contactPerson: 'Anna Illing-Schmidt',
      street: 'Neue Straße 1',
      zip: '12345',
      city: 'Musterstadt',
    });
    // … the stored PDF and the snapshots stay as they were (FR-INV-15, FR-COMP-05).
    const second = (await download(saved.id)).rawPayload;
    expect(Buffer.compare(first, second)).toBe(0);
    const detail = (await ctx.user.get(`/api/invoices/${saved.id}`)).json();
    expect(detail.number).toBe(number);
    expect((await ctx.user.get(`/api/invoices?status=OPEN`)).json().items).toContainEqual(
      expect.objectContaining({ id: saved.id, customerName: 'Anna Illing' }),
    );
    await ctx.user.put('/api/company', COMPLETE_COMPANY);
    await ctx.user.put(`/api/customers/${illing}`, {
      type: 'PRIVATE',
      contactPerson: 'Anna Illing',
      street: 'Gartenweg 7',
      zip: '12345',
      city: 'Musterstadt',
    });
  });

  it('makes the invoice read-only and logs the status change', async () => {
    const saved = await draft(illing, { positions: [position('WORK', 'Arbeit', 1000)] });
    const finalized = (await finalize(saved)).json();
    expect((await finalize(finalized)).json().error).toBe('INVOICE_NOT_EDITABLE');
    const edit = await ctx.user.put(`/api/invoices/${saved.id}`, {
      ...saved,
      version: finalized.version,
    });
    expect(edit.statusCode).toBe(409);
    expect((await ctx.user.request('DELETE', `/api/invoices/${saved.id}`)).statusCode).toBe(409);
    const history = await ctx.t
      .db('invoice_status_history')
      .where({ invoice_id: saved.id })
      .orderBy('id');
    expect(history.map((h) => [h.from_status, h.to_status])).toEqual([
      [null, 'DRAFT'],
      ['DRAFT', 'OPEN'],
    ]);
  });

  it('refuses incomplete drafts without consuming a number (FR-INV-07)', async () => {
    const before = (await ctx.admin.get('/api/settings/numbering')).json().nextNumber;
    const empty = await draft(illing, { positions: [] });
    const res = await finalize(empty);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVOICE_INCOMPLETE', problems: ['NO_POSITIONS'] });
    const noCustomer = (await ctx.user.post('/api/invoices', {})).json();
    expect((await finalize(noCustomer)).json().problems).toContain('CUSTOMER_MISSING');
    expect((await ctx.admin.get('/api/settings/numbering')).json().nextNumber).toBe(before);
  });

  it('refuses to finalize a version the user has not seen', async () => {
    const saved = await draft(illing, { positions: [position('WORK', 'Arbeit', 1000)] });
    const res = await ctx.user.post(`/api/invoices/${saved.id}/finalize`, {
      version: saved.version - 1,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('INVOICE_CHANGED');
  });

  it('rolls everything back when the PDF cannot be rendered – no gap in the numbers', async () => {
    const failing: InvoiceRenderer = {
      mimeType: 'application/pdf',
      render: () => Promise.reject(new Error('renderer crashed')),
    };
    const brokenApp = await buildApp({ config: ctx.t.config, db: ctx.t.db, renderer: failing });
    try {
      const client = new TestClient(brokenApp);
      await client.login('worker', 'worker-password-final');
      const saved = await draft(illing, { positions: [position('WORK', 'Arbeit', 1000)] });
      const before = (await ctx.admin.get('/api/settings/numbering')).json().nextNumber;
      const res = await client.post(`/api/invoices/${saved.id}/finalize`, {
        version: saved.version,
      });
      expect(res.statusCode).toBe(500);
      const after = (await ctx.user.get(`/api/invoices/${saved.id}`)).json();
      expect(after).toMatchObject({ status: 'DRAFT', number: null, version: saved.version });
      expect((await ctx.admin.get('/api/settings/numbering')).json().nextNumber).toBe(before);
      // The healthy app finalizes it with exactly that number.
      expect((await finalize(saved)).json().number).toBe(before);
    } finally {
      await brokenApp.close();
    }
  });

  it('parallel finalizations get distinct, consecutive numbers (TR-03 end to end)', async () => {
    const drafts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        draft(illing, { positions: [position('WORK', `Auftrag ${i}`, 1000 + i)] }),
      ),
    );
    const results = await Promise.all(drafts.map((d) => finalize(d)));
    const numbers = results.map((r) => Number(r.json().number)).sort((a, b) => a - b);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(numbers).toEqual(Array.from({ length: 6 }, (_, i) => numbers[0]! + i));
  });
});

describe('preview and download (FR-INV-12, FR-PDF-02, NFR-PERF-01)', () => {
  it('previews drafts with a watermark and without number', async () => {
    const saved = await draft(illing, { positions: [position('WORK', 'Vorschau-Arbeit', 1000)] });
    const res = await ctx.user.get(`/api/invoices/${saved.id}/preview`);
    expect(res.statusCode).toBe(200);
    const { text } = await pdfText(res.rawPayload);
    expectAll(text, ['ENTWURF', 'Rechnung', 'Vorschau-Arbeit', 'Anna Illing']);
    expect(text).not.toContain('Rechnungsnummer');
    // Drafts have no stored PDF yet.
    expect((await ctx.user.get(`/api/invoices/${saved.id}/pdf`)).json().error).toBe(
      'INVOICE_NOT_FINALIZED',
    );
  });

  it('returns the stored file as preview of finalized invoices', async () => {
    const saved = await draft(illing, { positions: [position('WORK', 'Arbeit', 1000)] });
    await finalize(saved);
    const preview = await ctx.user.get(`/api/invoices/${saved.id}/preview`);
    expect(Buffer.compare(preview.rawPayload, (await download(saved.id)).rawPayload)).toBe(0);
  });

  it('lays out long invoices over several pages within 3 seconds', async () => {
    const positions = Array.from({ length: 45 }, (_, i) =>
      position(
        i % 3 === 0 ? 'MATERIAL' : 'WORK',
        `Position ${i + 1}: Wand spachteln, schleifen und zweimal streichen\nRaum ${i + 1}, ca. 25 m²`,
        1000 * (i + 1),
      ),
    );
    const saved = await draft(illing, { positions });
    const started = performance.now();
    const res = await ctx.user.get(`/api/invoices/${saved.id}/preview`);
    const elapsed = performance.now() - started;
    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(3000);

    const { text, pages } = await pdfText(res.rawPayload);
    expect(pages).toBeGreaterThanOrEqual(3);
    for (let page = 1; page <= pages; page++) expect(text).toContain(`Seite ${page} von ${pages}`);
    // The table header is repeated on every page with positions.
    expect(text.split('Beschreibung').length - 1).toBeGreaterThanOrEqual(pages - 1);
    for (let i = 1; i <= 45; i++) expect(text).toContain(`Position ${i}:`);
  });
});
