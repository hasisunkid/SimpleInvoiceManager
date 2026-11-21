import { Readable } from 'node:stream';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { invoiceFileName, type BuyerSnapshot } from '@sim/domain';
import { translate, type Language } from '@sim/i18n';
import type { Db } from '../db.js';
import { migrationStatus } from '../db.js';
import type { FileStore, StoredFileRow } from '../files/store.js';
import { zipStream, type ZipEntry } from '../files/zip.js';
import { businessToday } from '../time.js';
import { errorResponses } from '../schemas.js';
import { contentDisposition } from './invoices.js';

const BinarySchema = Type.Unsafe<Buffer>({ type: 'string', format: 'binary' });
/** Streamed binary response – Fastify pipes Readables unserialized. */
const StreamSchema = Type.Unsafe<Readable>({ type: 'string', format: 'binary' });

/**
 * Tables in the JSON export (NFR-DATA-02). Sessions are left out; users are exported without
 * password hashes – the export may be stored or sent somewhere less protected than the server.
 */
const EXPORT_TABLES = [
  'company_profile',
  'company_text',
  'invoice_style',
  'number_sequence',
  'app_user',
  'customer',
  'catalog_item',
  'invoice',
  'invoice_position',
  'invoice_status_history',
  'stored_file',
] as const;

const JSON_COLUMNS = new Set(['seller_snapshot', 'buyer_snapshot']);

function plain(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'password_hash') continue;
    out[key] =
      JSON_COLUMNS.has(key) && typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  }
  return out;
}

/** NFR-DATA-02: administrators can export all data (JSON) and all PDFs (ZIP). */
export const adminRoutes: FastifyPluginAsyncTypebox<{ db: Db; files: FileStore }> = async (
  app,
  { db, files },
) => {
  app.get(
    '/admin/export/data',
    {
      config: { admin: true },
      schema: {
        summary: 'Export all data as JSON (without password hashes and sessions)',
        tags: ['admin'],
        produces: ['application/json'],
        response: { 200: BinarySchema, ...errorResponses(401, 403) },
      },
    },
    async (request, reply) => {
      const data: Record<string, unknown[]> = {};
      for (const table of EXPORT_TABLES) {
        const rows = (await db(table).select('*').orderByRaw('1')) as Record<string, unknown>[];
        data[table] = rows.map(plain);
      }
      const { applied } = await migrationStatus(db);
      const body = JSON.stringify(
        {
          format: 'simpleinvoice-export',
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          exportedBy: request.auth?.user.username ?? null,
          schemaMigrations: applied,
          note: 'Users are exported without password hashes; sessions are not exported.',
          data,
        },
        null,
        2,
      );
      request.log.info({ tables: EXPORT_TABLES.length }, 'data export');
      return reply
        .type('application/json; charset=utf-8')
        .header(
          'Content-Disposition',
          contentDisposition(`simpleinvoice-export-${businessToday()}.json`).replace(
            'inline',
            'attachment',
          ),
        )
        .header('Cache-Control', 'no-store')
        .send(Buffer.from(body, 'utf8'));
    },
  );

  app.get(
    '/admin/export/pdfs',
    {
      config: { admin: true },
      schema: {
        summary: 'Export all stored invoice PDFs as ZIP (streamed)',
        tags: ['admin'],
        produces: ['application/zip'],
        response: { 200: StreamSchema, ...errorResponses(401, 403) },
      },
    },
    async (request, reply) => {
      const rows = (await db('invoice as i')
        .join('stored_file as f', 'f.id', 'i.pdf_file_id')
        .whereNotNull('i.number')
        .orderBy('i.id')
        .select(
          'i.number',
          'i.invoice_date',
          'i.document_language',
          'i.buyer_snapshot',
          'f.id as file_id',
        )) as {
        number: string;
        invoice_date: string;
        document_language: Language;
        buyer_snapshot: string | BuyerSnapshot;
        file_id: number;
      }[];

      const entries: ZipEntry[] = rows.map((row) => {
        const buyer =
          typeof row.buyer_snapshot === 'string'
            ? (JSON.parse(row.buyer_snapshot) as BuyerSnapshot)
            : row.buyer_snapshot;
        const name = invoiceFileName(
          translate(row.document_language, 'pdf.filePrefix'),
          row.number,
          buyer,
          row.invoice_date,
        );
        return {
          name: `${row.invoice_date.slice(0, 4)}/${name}`,
          date: new Date(`${row.invoice_date}T12:00:00`),
          read: async () =>
            files.read((await files.find(row.file_id, 'INVOICE_PDF')) as StoredFileRow),
        };
      });
      request.log.info({ files: entries.length }, 'PDF export');
      return reply
        .type('application/zip')
        .header(
          'Content-Disposition',
          contentDisposition(`simpleinvoice-pdfs-${businessToday()}.zip`).replace(
            'inline',
            'attachment',
          ),
        )
        .header('Cache-Control', 'no-store')
        .send(Readable.from(zipStream(entries)));
    },
  );
};
