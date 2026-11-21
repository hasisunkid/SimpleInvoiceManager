import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { createTestApp, pdfText, type TestApp } from './helpers/setup.js';
import { COMPLETE_COMPANY } from './helpers/fixtures.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp('style');
  expect((await ctx.user.put('/api/company', COMPLETE_COMPANY)).statusCode).toBe(200);
});
afterAll(async () => ctx?.close());

const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">' +
  '<rect width="300" height="100" fill="#3A7CA5"/></svg>';
const pngLogo = () => new Resvg(LOGO_SVG).render().asPng();

async function upload(body: Buffer | string, contentType: string) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/settings/style/logo',
    headers: {
      cookie: ctx.admin.cookie!,
      'x-csrf-token': ctx.admin.csrfToken!,
      'content-type': contentType,
    },
    payload: body,
  });
}

describe('logo upload (FR-STYLE-01, NFR-SEC-01)', () => {
  it('is admin only', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/settings/style/logo',
      headers: {
        cookie: ctx.user.cookie!,
        'x-csrf-token': ctx.user.csrfToken!,
        'content-type': 'image/png',
      },
      payload: pngLogo(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('stores a PNG and serves it back unchanged', async () => {
    const png = pngLogo();
    const res = await upload(png, 'image/png');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ mimeType: 'image/png', width: 300, height: 100 });
    const back = await ctx.admin.get(`/api/settings/style/logo/${res.json().fileId}`);
    expect(back.headers['content-type']).toBe('image/png');
    expect(back.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(back.rawPayload, png)).toBe(0);
  });

  it('converts SVG to PNG, which drops scripts', async () => {
    const svg = LOGO_SVG.replace('</svg>', '<script>alert(1)</script></svg>');
    const res = await upload(svg, 'image/svg+xml');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ mimeType: 'image/png', width: 1200, height: 400 });
  });

  it.each([
    ['external references', LOGO_SVG.replace('<rect', '<image href="file:///etc/passwd"/><rect')],
    ['DTDs / entities', `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]>${LOGO_SVG}`],
    ['extreme aspect ratios', '<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="1"/>'],
  ])('rejects SVGs with %s', async (_, svg) => {
    const res = await upload(svg, 'image/svg+xml');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^LOGO_(INVALID|DIMENSIONS)$/);
  });

  it('checks the real content type, not the declared one', async () => {
    const res = await upload('this is not an image', 'image/png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('LOGO_INVALID_TYPE');
  });

  it('rejects unsupported content types', async () => {
    const res = await upload('GIF89a', 'image/gif');
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe('LOGO_INVALID_TYPE');
  });

  it('rejects files over 2 MB', async () => {
    const res = await upload(Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png');
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('LOGO_TOO_LARGE');
  });

  it('rejects pixel bombs before decoding them', async () => {
    const png = Buffer.from(pngLogo());
    png.writeUInt32BE(20_000, 16); // IHDR width
    png.writeUInt32BE(20_000, 20); // IHDR height
    const res = await upload(png, 'image/png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('LOGO_DIMENSIONS');
  });

  it('rejects corrupt images that the PDF library cannot embed', async () => {
    const png = Buffer.from(pngLogo()).subarray(0, 60);
    const res = await upload(png, 'image/png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('LOGO_INVALID');
  });
});

describe('invoice style (FR-STYLE-01, -02)', () => {
  it('has the reference blue by default and no logo', async () => {
    const res = await ctx.admin.get('/api/settings/style');
    expect(res.json()).toEqual({ logoPosition: 'LEFT', accentColor: '#3A7CA5', logo: null });
  });

  it('saves logo, position and colour', async () => {
    const { fileId } = (await upload(pngLogo(), 'image/png')).json();
    const res = await ctx.admin.put('/api/settings/style', {
      logoFileId: fileId,
      logoPosition: 'RIGHT',
      accentColor: '#aa3300',
    });
    expect(res.statusCode).toBe(200);
    expect((await ctx.admin.get('/api/settings/style')).json()).toMatchObject({
      logoPosition: 'RIGHT',
      accentColor: '#AA3300',
      logo: { fileId, mimeType: 'image/png' },
    });
  });

  it('rejects unknown files and invalid colours', async () => {
    const base = { logoFileId: null, logoPosition: 'LEFT', accentColor: '#3A7CA5' };
    expect(
      (await ctx.admin.put('/api/settings/style', { ...base, logoFileId: 9999 })).json().error,
    ).toBe('FILE_NOT_FOUND');
    expect(
      (await ctx.admin.put('/api/settings/style', { ...base, accentColor: 'red' })).statusCode,
    ).toBe(400);
  });

  it('is admin only', async () => {
    expect((await ctx.user.get('/api/settings/style')).statusCode).toBe(403);
  });
});

describe('live preview (FR-STYLE-03, FR-I18N-05)', () => {
  const preview = (body: object) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/settings/style/preview',
      headers: { cookie: ctx.admin.cookie!, 'x-csrf-token': ctx.admin.csrfToken! },
      payload: {
        logoFileId: null,
        logoPosition: 'LEFT',
        accentColor: '#3A7CA5',
        language: 'de',
        ...body,
      },
    });

  it('renders a text-based sample PDF with the company data', async () => {
    const res = await preview({});
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const { text, pages } = await pdfText(res.rawPayload);
    expect(pages).toBe(1);
    for (const expected of [
      'BAU & RENOVIERUNG GÓRALEWICZ',
      'Jan Góralewicz',
      'Hauptstraße 1',
      'Rechnung',
      'MUSTER',
      'Leistungsdatum',
      'Zahlungsziel',
      '30 Tage',
      '1.755,00 €',
      '640,00 €',
      'Zwischensumme',
      '2.395,00 €',
      'MwSt. 19 %',
      '455,05 €',
      '2.850,05 €',
      'St.-Nr. 12/345/67890',
      'DE89 3704 0044 0532 0130 00',
      'Seite 1 von 1',
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it('uses unsaved style settings including the logo', async () => {
    const { fileId } = (await upload(pngLogo(), 'image/png')).json();
    const res = await preview({ logoFileId: fileId, logoPosition: 'RIGHT' });
    expect(res.statusCode).toBe(200);
    // With a logo, the company name is not printed as large header text.
    expect((await pdfText(res.rawPayload)).text).not.toContain('BAU & RENOVIERUNG GÓRALEWICZ');
  });

  it('prints labels in the document language (FR-I18N-02)', async () => {
    const { text } = await pdfText((await preview({ language: 'pl' })).rawPayload);
    for (const expected of ['Faktura', 'WZÓR', 'Data wykonania usługi', 'Razem', 'Strona 1 z 1']) {
      expect(text, expected).toContain(expected);
    }
  });

  it('prints the § 19 note and no VAT for small businesses (FR-INV-06)', async () => {
    await ctx.user.put('/api/company', { ...COMPLETE_COMPANY, taxMode: 'SMALL_BUSINESS_19' });
    const { text } = await pdfText((await preview({})).rawPayload);
    expect(text).toContain('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
    expect(text).not.toContain('MwSt.');
    expect(text).toContain('2.395,00 €');
    await ctx.user.put('/api/company', COMPLETE_COMPANY);
  });

  it('is admin only', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/settings/style/preview',
      headers: { cookie: ctx.user.cookie!, 'x-csrf-token': ctx.user.csrfToken! },
      payload: { logoFileId: null, logoPosition: 'LEFT', accentColor: '#3A7CA5', language: 'de' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('cleanup of unused logo uploads', () => {
  it('removes only old, unreferenced logos and never touches invoice PDFs', async () => {
    const { FileStore } = await import('../src/files/store.js');
    const store = new FileStore(ctx.t.db, ctx.t.config.dataDir);
    const used = (await upload(pngLogo(), 'image/png')).json().fileId;
    await ctx.admin.put('/api/settings/style', {
      logoFileId: used,
      logoPosition: 'LEFT',
      accentColor: '#3A7CA5',
    });
    const svg = (await upload(LOGO_SVG.replace('#3A7CA5', '#123456'), 'image/svg+xml')).json()
      .fileId;
    await ctx.t.db('stored_file').update({ created_at: new Date('2020-01-01') });

    const before = await ctx.t.db('stored_file').count({ n: '*' }).first();
    const removed = await store.cleanupUnusedLogos();
    expect(removed).toBeGreaterThan(0);
    const left = await ctx.t.db('stored_file').select('id', 'kind');
    expect(left.map((r) => r.id)).toContain(used);
    expect(left.map((r) => r.id)).not.toContain(svg);
    expect(left.length).toBe(Number(before!.n) - removed);
    // The referenced logo still loads.
    expect((await ctx.admin.get(`/api/settings/style/logo/${used}`)).statusCode).toBe(200);
    expect(await store.cleanupUnusedLogos()).toBe(0);
  });
});
