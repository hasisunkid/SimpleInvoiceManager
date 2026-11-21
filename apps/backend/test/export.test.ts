import { crc32 } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/setup.js';
import { COMPLETE_COMPANY } from './helpers/fixtures.js';

let ctx: TestApp;
const ids: number[] = [];

/** Reads a stored-only ZIP via its central directory and checks every CRC. */
function readZip(zip: Buffer): { name: string; data: Buffer }[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);
  const count = zip.readUInt16LE(end + 10);
  let pos = zip.readUInt32LE(end + 16);
  const entries: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(pos)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(pos + 16);
    const size = zip.readUInt32LE(pos + 20);
    const nameLength = zip.readUInt16LE(pos + 28);
    const local = zip.readUInt32LE(pos + 42);
    const name = zip.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    const localNameLength = zip.readUInt16LE(local + 26);
    const data = zip.subarray(local + 30 + localNameLength, local + 30 + localNameLength + size);
    expect(crc32(data), name).toBe(crc);
    entries.push({ name, data });
    pos += 46 + nameLength;
  }
  return entries;
}

beforeAll(async () => {
  ctx = await createTestApp('export');
  await ctx.user.put('/api/company', COMPLETE_COMPANY);
  await ctx.admin.put('/api/settings/numbering', {
    prefix: '',
    minDigits: 0,
    nextValue: 104,
    resetYearly: false,
  });
  const customerId = (
    await ctx.user.post('/api/customers', {
      type: 'PRIVATE',
      contactPerson: 'Łukasz Wiśniewski',
      street: 'Gartenweg 7',
      zip: '12345',
      city: 'Musterstadt',
      invoiceLanguage: 'pl',
    })
  ).json().id;
  for (const cents of [8000, 25_000]) {
    const draft = (await ctx.user.post('/api/invoices', { customerId })).json();
    const saved = (
      await ctx.user.put(`/api/invoices/${draft.id}`, {
        version: draft.version,
        customerId,
        documentLanguage: draft.documentLanguage,
        invoiceDate: '2024-11-18',
        serviceDateFrom: '2024-11-18',
        serviceDateTo: null,
        paymentTermDays: 30,
        siteAddress: '',
        subject: '',
        introText: '',
        closingText: '',
        positions: [
          {
            type: 'WORK',
            description: 'Praca',
            quantityMilli: 1000,
            unitCode: 'LS',
            unitPriceCents: cents,
            vatRate: 19,
          },
        ],
      })
    ).json();
    const final = await ctx.user.post(`/api/invoices/${saved.id}/finalize`, {
      version: saved.version,
    });
    expect(final.statusCode, final.body).toBe(200);
    ids.push(saved.id);
  }
  await ctx.user.post('/api/invoices', { customerId }); // a draft without PDF
});
afterAll(async () => ctx?.close());

describe('data export (NFR-DATA-02)', () => {
  it('contains every table – but no password hashes and no sessions', async () => {
    const res = await ctx.admin.get('/api/admin/export/data');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="simpleinvoice-export-/,
    );
    const body = res.json();
    expect(body).toMatchObject({
      format: 'simpleinvoice-export',
      formatVersion: 1,
      exportedBy: 'admin',
    });
    expect(Object.keys(body.data)).toEqual(
      expect.arrayContaining([
        'invoice',
        'invoice_position',
        'customer',
        'app_user',
        'company_profile',
      ]),
    );
    expect(body.data).not.toHaveProperty('session');
    expect(res.body).not.toContain('password_hash');
    expect(res.body).not.toContain('$argon2');
    expect(body.data.invoice).toHaveLength(3);
    // Snapshots come as objects, not as JSON strings.
    const finalized = body.data.invoice.find((i: { number: string | null }) => i.number === '104');
    expect(finalized.buyer_snapshot.name).toBe('Łukasz Wiśniewski');
  });
});

describe('PDF export (NFR-DATA-02, NFR-DATA-01)', () => {
  it('streams every stored PDF, byte-identical, with reference file names', async () => {
    const res = await ctx.admin.get('/api/admin/export/pdfs');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const entries = readZip(res.rawPayload);
    expect(entries.map((e) => e.name)).toEqual([
      '2024/Faktura_104_Wiśniewski_18.11.2024.pdf',
      '2024/Faktura_105_Wiśniewski_18.11.2024.pdf',
    ]);
    for (const [index, id] of ids.entries()) {
      const stored = (await ctx.admin.get(`/api/invoices/${id}/pdf`)).rawPayload;
      expect(Buffer.compare(entries[index]!.data, stored)).toBe(0);
    }
  });
});
