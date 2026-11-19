import type { FastifyError } from 'fastify';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  applyNumberingSettings,
  effectiveNextValue,
  formatInvoiceNumber,
  validateNumbering,
  type NumberingState,
} from '@sim/domain';
import type { Db } from '../db.js';
import { currentAuth } from '../auth/guard.js';
import { loadCompany } from '../company/repository.js';
import { handleError } from '../errors.js';
import type { FileStore } from '../files/store.js';
import { loadNumbering, saveNumbering } from '../numbering/repository.js';
import { canEmbedImage } from '../pdf/pdfmake-renderer.js';
import { buildSampleInvoice } from '../pdf/sample.js';
import type { InvoiceRenderer } from '../pdf/types.js';
import { LogoError, MAX_LOGO_BYTES, processLogo } from '../style/logo.js';
import { loadStyle, saveStyle } from '../style/repository.js';
import { businessToday, businessYear } from '../time.js';
import { IdParamsSchema, LanguageSchema, errorResponses } from '../schemas.js';

export interface SettingsRoutesOptions {
  db: Db;
  files: FileStore;
  renderer: InvoiceRenderer;
}

/** Binary response (image or PDF) – Fastify sends Buffers unserialized. */
const BinarySchema = Type.Unsafe<Buffer>({ type: 'string', format: 'binary' });

const LogoPositionSchema = Type.Union([Type.Literal('LEFT'), Type.Literal('RIGHT')]);
const ColorSchema = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' });

const StyleBody = Type.Object({
  logoPosition: LogoPositionSchema,
  accentColor: ColorSchema,
  logoFileId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});

const LogoInfo = Type.Object({
  fileId: Type.Integer(),
  mimeType: Type.String(),
  width: Type.Integer(),
  height: Type.Integer(),
});

const StyleResponse = Type.Object({
  logoPosition: LogoPositionSchema,
  accentColor: Type.String(),
  logo: Type.Union([LogoInfo, Type.Null()]),
});

const NumberingBody = Type.Object({
  prefix: Type.String({ maxLength: 20 }),
  minDigits: Type.Integer({ minimum: 0, maximum: 8 }),
  nextValue: Type.Integer({ minimum: 1, maximum: 99_999_999 }),
  resetYearly: Type.Boolean(),
});

const NumberingResponse = Type.Object({
  prefix: Type.String(),
  minDigits: Type.Integer(),
  /** Value the next finalization gets (after a possible yearly reset). */
  nextValue: Type.Integer(),
  resetYearly: Type.Boolean(),
  configured: Type.Boolean(),
  /** Last number used in the current period, formatted; null if none. */
  lastAssigned: Type.Union([Type.String(), Type.Null()]),
  /** The next invoice number as it would be printed today. */
  nextNumber: Type.String(),
});

function numberingResponse(state: NumberingState, configured: boolean, year: number) {
  const next = effectiveNextValue(state, year);
  // After a due yearly reset, the previous year's numbers no longer limit the next number.
  const periodEnded = state.resetYearly && state.currentYear !== null && year > state.currentYear;
  const last =
    state.lastAssigned !== null && state.currentYear !== null && !periodEnded
      ? formatInvoiceNumber(state, state.lastAssigned, state.currentYear)
      : null;
  return {
    prefix: state.prefix,
    minDigits: state.minDigits,
    nextValue: next,
    resetYearly: state.resetYearly,
    configured,
    lastAssigned: last,
    nextNumber: formatInvoiceNumber(state, next, year),
  };
}

/** FR-STYLE-01..03, FR-NUM-01..04 – administrators only (decision D6). */
export const settingsRoutes: FastifyPluginAsyncTypebox<SettingsRoutesOptions> = async (
  app,
  { db, files, renderer },
) => {
  const fileNotFound = { error: 'FILE_NOT_FOUND', message: 'Logo file not found' } as const;

  async function logoInfo(fileId: number | null) {
    if (fileId === null) return null;
    const row = await files.find(fileId, 'LOGO');
    return row
      ? { fileId: row.id, mimeType: row.mime_type, width: row.width ?? 0, height: row.height ?? 0 }
      : null;
  }

  // ---------- invoice style ----------
  app.get(
    '/settings/style',
    {
      config: { admin: true },
      schema: {
        summary: 'Invoice style (logo, accent colour)',
        tags: ['settings'],
        response: { 200: StyleResponse, ...errorResponses(401, 403) },
      },
    },
    async () => {
      const style = await loadStyle(db);
      return {
        logoPosition: style.logoPosition,
        accentColor: style.accentColor,
        logo: await logoInfo(style.logoFileId),
      };
    },
  );

  app.put(
    '/settings/style',
    {
      config: { admin: true },
      schema: {
        summary: 'Save the invoice style',
        tags: ['settings'],
        body: StyleBody,
        response: { 200: StyleResponse, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const { logoFileId, logoPosition, accentColor } = request.body;
      if (logoFileId !== null && !(await files.find(logoFileId, 'LOGO'))) {
        return reply.code(400).send(fileNotFound);
      }
      await saveStyle(db, { logoFileId, logoPosition, accentColor }, currentAuth(request).user.id);
      return {
        logoPosition,
        accentColor: accentColor.toUpperCase(),
        logo: await logoInfo(logoFileId),
      };
    },
  );

  // Raw image upload (no multipart): the body is the file itself, limited to 2 MB.
  await app.register(async (upload) => {
    upload.addContentTypeParser(
      ['image/png', 'image/jpeg', 'image/svg+xml'],
      { parseAs: 'buffer', bodyLimit: MAX_LOGO_BYTES },
      (_request, body, done) => done(null, body),
    );
    upload.setErrorHandler<FastifyError>((err, request, reply) => {
      if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        return reply.code(413).send({ error: 'LOGO_TOO_LARGE', message: 'Logo exceeds 2 MB' });
      }
      if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_ERR_CTP_EMPTY_TYPE') {
        return reply
          .code(415)
          .send({ error: 'LOGO_INVALID_TYPE', message: 'PNG, JPEG or SVG required' });
      }
      return handleError(err, request, reply);
    });

    upload.post(
      '/settings/style/logo',
      {
        config: { admin: true },
        bodyLimit: MAX_LOGO_BYTES,
        schema: {
          summary: 'Upload a logo (raw PNG, JPEG or SVG body, max 2 MB). SVG is converted to PNG.',
          tags: ['settings'],
          consumes: ['image/png', 'image/jpeg', 'image/svg+xml'],
          response: { 201: LogoInfo, ...errorResponses(400, 401, 403, 413, 415) },
        },
      },
      async (request, reply) => {
        const body = request.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          return reply.code(400).send({ error: 'LOGO_INVALID', message: 'Empty upload' });
        }
        try {
          const logo = processLogo(body);
          if (!(await canEmbedImage(logo.data, logo.mimeType))) throw new LogoError('LOGO_INVALID');
          const row = await files.save('LOGO', logo.data, logo.mimeType, {
            createdBy: currentAuth(request).user.id,
            width: logo.width,
            height: logo.height,
          });
          return reply.code(201).send({
            fileId: row.id,
            mimeType: row.mime_type,
            width: logo.width,
            height: logo.height,
          });
        } catch (err) {
          if (err instanceof LogoError) {
            return reply.code(400).send({ error: err.code, message: 'Logo rejected' });
          }
          throw err;
        }
      },
    );
  });

  app.get(
    '/settings/style/logo/:id',
    {
      config: { admin: true },
      schema: {
        summary: 'Download an uploaded logo',
        tags: ['settings'],
        params: IdParamsSchema,
        produces: ['image/png', 'image/jpeg'],
        response: { 200: BinarySchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      const row = await files.find(request.params.id, 'LOGO');
      if (!row) return reply.code(404).send(fileNotFound);
      return reply
        .type(row.mime_type)
        .header('Cache-Control', 'private, max-age=86400, immutable')
        .header('X-Content-Type-Options', 'nosniff')
        .send(await files.read(row));
    },
  );

  app.post(
    '/settings/style/preview',
    {
      config: { admin: true },
      schema: {
        summary: 'Render a sample invoice PDF with the given (unsaved) style (FR-STYLE-03)',
        tags: ['settings'],
        body: Type.Composite([StyleBody, Type.Object({ language: LanguageSchema })]),
        produces: ['application/pdf'],
        response: { 200: BinarySchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const { logoFileId, logoPosition, accentColor, language } = request.body;
      let logo: { data: Buffer; mimeType: string } | null = null;
      if (logoFileId !== null) {
        const row = await files.find(logoFileId, 'LOGO');
        if (!row) return reply.code(400).send(fileNotFound);
        logo = { data: await files.read(row), mimeType: row.mime_type };
      }
      const { profile } = await loadCompany(db);
      const sample = buildSampleInvoice(
        profile,
        { logoPosition, accentColor, logo },
        language,
        businessToday(),
      );
      const pdf = await renderer.render(sample);
      return reply
        .type(renderer.mimeType)
        .header('Content-Disposition', 'inline; filename="preview.pdf"')
        .header('Cache-Control', 'no-store')
        .send(pdf);
    },
  );

  // ---------- number range ----------
  app.get(
    '/settings/numbering',
    {
      config: { admin: true },
      schema: {
        summary: 'Invoice number range',
        tags: ['settings'],
        response: { 200: NumberingResponse, ...errorResponses(401, 403) },
      },
    },
    async () => {
      const { state, configured } = await loadNumbering(db);
      return numberingResponse(state, configured, businessYear());
    },
  );

  app.put(
    '/settings/numbering',
    {
      config: { admin: true },
      schema: {
        summary: 'Configure the invoice number range (FR-NUM-01, FR-NUM-04)',
        tags: ['settings'],
        body: NumberingBody,
        response: { 200: NumberingResponse, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const year = businessYear();
      const settings = { ...request.body, prefix: request.body.prefix.trim() };
      const result = await db.transaction(async (trx) => {
        // Same row lock as number assignment: no finalization can slip in between.
        const { state } = await loadNumbering(trx, { forUpdate: true });
        const problems = validateNumbering(settings, state, year);
        if (problems.length > 0) return { problems };
        const next = applyNumberingSettings(state, settings, year);
        await saveNumbering(trx, next, currentAuth(request).user.id);
        return { state: next };
      });
      if (result.problems) {
        return reply
          .code(400)
          .send({ error: result.problems[0]!, message: 'Invalid number range settings' });
      }
      return numberingResponse(result.state!, true, year);
    },
  );
};
