import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import {
  buyerSnapshot,
  invoiceFileName,
  sellerSnapshot,
  MAX_POSITIONS,
  MAX_QUANTITY_MILLI,
  MAX_UNIT_PRICE_CENTS,
  calculateInvoice,
  finalizeProblems,
  isIsoDate,
  isValidPaymentDate,
  isOverdue,
  type InvoiceDraftData,
  type TaxMode,
} from '@sim/domain';
import { translate, type Language } from '@sim/i18n';
import type { Db } from '../db.js';
import { currentAuth } from '../auth/guard.js';
import { loadCompany } from '../company/repository.js';
import type { FileStore } from '../files/store.js';
import { finalizeInvoice } from '../invoices/finalize.js';
import { changeStatus, type StatusChangeResult } from '../invoices/status.js';
import { buildInvoiceDocument, loadPrintStyle } from '../pdf/invoice-document.js';
import type { InvoiceRenderer } from '../pdf/types.js';
import { findCustomer, type Customer } from '../customers/repository.js';
import {
  createDraft,
  deleteDraft,
  findInvoice,
  invoiceSummary,
  listInvoices,
  statusHistory,
  saveDraft,
  type StoredInvoice,
} from '../invoices/repository.js';
import { loadNumbering } from '../numbering/repository.js';
import { businessToday } from '../time.js';
import { IdParamsSchema, LanguageSchema, errorResponses } from '../schemas.js';
import { CustomerSchema } from './customers.js';
import { PositionTypeSchema, UnitCodeSchema, VatRateSchema } from './catalog.js';

const StatusSchema = Type.Union([
  Type.Literal('DRAFT'),
  Type.Literal('OPEN'),
  Type.Literal('PAID'),
  Type.Literal('CANCELLED'),
]);
const DateSchema = Type.String({ format: 'date', description: 'YYYY-MM-DD' });

const PositionSchema = Type.Object({
  type: PositionTypeSchema,
  description: Type.String({ maxLength: 4000 }),
  quantityMilli: Type.Integer({
    minimum: 1,
    maximum: MAX_QUANTITY_MILLI,
    description: 'thousandths',
  }),
  unitCode: UnitCodeSchema,
  unitPriceCents: Type.Integer({ minimum: 0, maximum: MAX_UNIT_PRICE_CENTS }),
  vatRate: VatRateSchema,
});

const DraftBody = Type.Object({
  /** Version the client last saw – stale saves are rejected (409 INVOICE_CHANGED). */
  version: Type.Integer({ minimum: 1 }),
  customerId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  documentLanguage: LanguageSchema,
  invoiceDate: DateSchema,
  serviceDateFrom: DateSchema,
  serviceDateTo: Type.Union([DateSchema, Type.Null()]),
  paymentTermDays: Type.Integer({ minimum: 0, maximum: 365 }),
  siteAddress: Type.String({ maxLength: 2000 }),
  subject: Type.String({ maxLength: 2000 }),
  introText: Type.String({ maxLength: 4000 }),
  closingText: Type.String({ maxLength: 4000 }),
  positions: Type.Array(PositionSchema, { maxItems: MAX_POSITIONS }),
});

const MoneyTotals = Type.Object({
  netCents: Type.Integer(),
  vatCents: Type.Integer(),
  grossCents: Type.Integer(),
  vatGroups: Type.Array(
    Type.Object({ rate: VatRateSchema, netCents: Type.Integer(), vatCents: Type.Integer() }),
  ),
  sections: Type.Object({
    WORK: Type.Object({ netCents: Type.Integer() }),
    MATERIAL: Type.Object({ netCents: Type.Integer() }),
  }),
  labourCostInclVatCents: Type.Integer(),
});

const InvoiceDetail = Type.Object({
  id: Type.Integer(),
  number: Type.Union([Type.String(), Type.Null()]),
  status: StatusSchema,
  version: Type.Integer(),
  customerId: Type.Union([Type.Integer(), Type.Null()]),
  customer: Type.Union([CustomerSchema, Type.Null()]),
  documentLanguage: LanguageSchema,
  invoiceDate: Type.String(),
  serviceDateFrom: Type.String(),
  serviceDateTo: Type.Union([Type.String(), Type.Null()]),
  paymentTermDays: Type.Integer(),
  dueDate: Type.String(),
  siteAddress: Type.String(),
  subject: Type.String(),
  introText: Type.String(),
  closingText: Type.String(),
  taxMode: Type.Union([Type.Literal('REGULAR'), Type.Literal('SMALL_BUSINESS_19')]),
  positions: Type.Array(
    Type.Composite([
      PositionSchema,
      Type.Object({ lineTotalCents: Type.Integer(), vatCategory: Type.String() }),
    ]),
  ),
  totals: MoneyTotals,
  /** FR-INV-07: what is still missing before the draft can be finalized (empty = ready). */
  finalizeProblems: Type.Array(Type.String()),
  overdue: Type.Boolean(),
  paidAt: Type.Union([Type.String(), Type.Null()]),
  cancelReason: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ListItem = Type.Object({
  id: Type.Integer(),
  number: Type.Union([Type.String(), Type.Null()]),
  status: StatusSchema,
  customerId: Type.Union([Type.Integer(), Type.Null()]),
  customerName: Type.String(),
  invoiceDate: Type.String(),
  dueDate: Type.String(),
  grossCents: Type.Integer(),
  overdue: Type.Boolean(),
});

const BinarySchema = Type.Unsafe<Buffer>({ type: 'string', format: 'binary' });

/** RFC 6266: ASCII fallback plus the exact UTF-8 name (keeps "Wiśniewski", "Müller"). */
export function contentDisposition(fileName: string): string {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export interface InvoiceRoutesOptions {
  db: Db;
  files: FileStore;
  renderer: InvoiceRenderer;
}

/** FR-INV-01..08, -11, -12, -15: invoices – available to every user. */
export const invoiceRoutes: FastifyPluginAsyncTypebox<InvoiceRoutesOptions> = async (
  app,
  { db, files, renderer },
) => {
  const notFound = { error: 'INVOICE_NOT_FOUND', message: 'Invoice not found' } as const;

  /** Full editor view: live totals for drafts (current company tax mode), § 14 check. */
  async function detail(invoice: StoredInvoice) {
    const [{ profile }, numbering, customer] = await Promise.all([
      loadCompany(db),
      loadNumbering(db),
      invoice.customerId ? findCustomer(db, invoice.customerId) : Promise.resolve(undefined),
    ]);
    const isDraft = invoice.status === 'DRAFT';
    const taxMode: TaxMode = isDraft ? profile.taxMode : invoice.taxMode;
    const { positions, totals } = calculateInvoice(invoice.positions, taxMode);
    const problems: string[] = isDraft ? finalizeProblems(invoice, customer ?? null, profile) : [];
    if (isDraft && !numbering.configured) problems.push('NUMBERING_NOT_CONFIGURED');
    return {
      ...invoice,
      taxMode,
      customer: customer ?? null,
      positions,
      totals: { ...totals, vatGroups: [...totals.vatGroups] },
      finalizeProblems: problems,
      overdue: isOverdue(invoice.status, invoice.dueDate, businessToday()),
    };
  }

  /** A customer may be chosen for an invoice only if it exists and is not archived. */
  async function checkCustomer(id: number): Promise<{ error: string; message: string } | Customer> {
    const customer = await findCustomer(db, id);
    if (!customer) return { error: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' };
    if (customer.archived) {
      return { error: 'CUSTOMER_ARCHIVED', message: 'Archived customers cannot be selected' };
    }
    return customer;
  }

  app.get(
    '/invoices',
    {
      schema: {
        summary: 'List invoices with filters, search and sorting (FR-INV-21)',
        tags: ['invoices'],
        querystring: Type.Object({
          status: Type.Optional(Type.Union([StatusSchema, Type.Literal('OVERDUE')])),
          customerId: Type.Optional(Type.Integer({ minimum: 1 })),
          from: Type.Optional(DateSchema),
          to: Type.Optional(DateSchema),
          q: Type.Optional(Type.String({ maxLength: 100 })),
          sort: Type.Optional(
            Type.Union([Type.Literal('date'), Type.Literal('number'), Type.Literal('amount')]),
          ),
          order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
          offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
        }),
        response: {
          200: Type.Object({
            items: Type.Array(ListItem),
            total: Type.Integer(),
            /** Sum of OPEN invoices matching the filter (FR-CUST-03 "open total"). */
            openTotalCents: Type.Integer(),
          }),
          ...errorResponses(400, 401, 403),
        },
      },
    },
    async (request) => {
      const { limit = 50, offset = 0, ...filters } = request.query;
      const today = businessToday();
      const result = await listInvoices(db, {
        today,
        limit,
        offset,
        ...Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''),
        ),
      });
      return {
        ...result,
        items: result.items.map((i) => ({ ...i, overdue: isOverdue(i.status, i.dueDate, today) })),
      };
    },
  );

  app.get(
    '/invoices/summary',
    {
      schema: {
        summary: 'Dashboard counters: drafts, open, overdue, paid this year (FR-INV-20)',
        tags: ['invoices'],
        response: {
          200: Type.Object({
            drafts: Type.Integer(),
            open: Type.Object({ count: Type.Integer(), grossCents: Type.Integer() }),
            overdue: Type.Object({ count: Type.Integer(), grossCents: Type.Integer() }),
            paidThisYear: Type.Object({ count: Type.Integer(), grossCents: Type.Integer() }),
          }),
          ...errorResponses(401, 403),
        },
      },
    },
    async () => invoiceSummary(db, businessToday()),
  );

  app.get(
    '/invoices/:id/history',
    {
      schema: {
        summary: 'Status changes with user and time (FR-INV-14)',
        tags: ['invoices'],
        params: IdParamsSchema,
        response: {
          200: Type.Array(
            Type.Object({
              fromStatus: Type.Union([StatusSchema, Type.Null()]),
              toStatus: StatusSchema,
              at: Type.String({ format: 'date-time' }),
              userName: Type.Union([Type.String(), Type.Null()]),
              note: Type.Union([Type.String(), Type.Null()]),
            }),
          ),
          ...errorResponses(401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      if (!(await findInvoice(db, request.params.id))) return reply.code(404).send(notFound);
      return statusHistory(db, request.params.id);
    },
  );

  /** Shared answer for pay / unpay / cancel. */
  async function statusReply(
    id: number,
    outcome: StatusChangeResult,
    reply: FastifyReply,
  ): Promise<FastifyReply | Awaited<ReturnType<typeof detail>>> {
    switch (outcome.result) {
      case 'not-found':
        return reply.code(404).send(notFound);
      case 'conflict':
        return reply.code(409).send({
          error: 'INVOICE_CHANGED',
          message: 'The invoice was changed elsewhere; reload it',
        });
      case 'not-allowed':
        return reply.code(409).send({
          error: 'INVALID_STATUS_CHANGE',
          message: `Not possible for an invoice with status ${outcome.status}`,
        });
      case 'changed':
        return detail((await findInvoice(db, id))!);
    }
  }

  app.post(
    '/invoices/:id/pay',
    {
      schema: {
        summary: 'Mark as paid (FR-INV-14); payment date defaults to today',
        tags: ['invoices'],
        params: IdParamsSchema,
        body: Type.Object({
          version: Type.Integer({ minimum: 1 }),
          paidAt: Type.Optional(DateSchema),
        }),
        response: { 200: InvoiceDetail, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const today = businessToday();
      const paidAt = request.body.paidAt ?? today;
      const invoice = await findInvoice(db, id);
      if (!invoice) return reply.code(404).send(notFound);
      if (!isValidPaymentDate(paidAt, invoice.invoiceDate, today)) {
        return reply.code(400).send({
          error: 'INVALID_PAYMENT_DATE',
          message: 'The payment date must lie between invoice date and today',
        });
      }
      const outcome = await changeStatus(
        db,
        id,
        'PAY',
        request.body.version,
        currentAuth(request).user.id,
        {
          paidAt,
        },
      );
      return statusReply(id, outcome, reply);
    },
  );

  app.post(
    '/invoices/:id/unpay',
    {
      schema: {
        summary: 'Undo "paid" (wrong click) – back to OPEN (FR-INV-14)',
        tags: ['invoices'],
        params: IdParamsSchema,
        body: Type.Object({ version: Type.Integer({ minimum: 1 }) }),
        response: { 200: InvoiceDetail, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const outcome = await changeStatus(
        db,
        id,
        'UNPAY',
        request.body.version,
        currentAuth(request).user.id,
      );
      return statusReply(id, outcome, reply);
    },
  );

  app.post(
    '/invoices/:id/cancel',
    {
      schema: {
        summary: 'Cancel an open invoice; a reason is required (FR-INV-13, decision D7)',
        tags: ['invoices'],
        params: IdParamsSchema,
        body: Type.Object({
          version: Type.Integer({ minimum: 1 }),
          reason: Type.String({ minLength: 1, maxLength: 1000 }),
        }),
        response: { 200: InvoiceDetail, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const reason = request.body.reason.trim();
      if (!reason) {
        return reply
          .code(400)
          .send({ error: 'CANCEL_REASON_REQUIRED', message: 'Please give a reason' });
      }
      const outcome = await changeStatus(
        db,
        id,
        'CANCEL',
        request.body.version,
        currentAuth(request).user.id,
        {
          reason,
        },
      );
      return statusReply(id, outcome, reply);
    },
  );

  app.post(
    '/invoices',
    {
      schema: {
        summary: 'Start a new draft with defaults (today, payment term, texts)',
        tags: ['invoices'],
        body: Type.Object({
          customerId: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
        }),
        response: { 201: InvoiceDetail, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const { customerId = null } = request.body;
      let language: Language = 'de';
      if (customerId !== null) {
        const customer = await checkCustomer(customerId);
        if ('error' in customer) return reply.code(400).send(customer);
        language = customer.invoiceLanguage;
      }
      const { profile } = await loadCompany(db);
      // FR-INV-02: invoice date = today, service date = invoice date; FR-COMP-03 defaults.
      const today = businessToday();
      const draft: InvoiceDraftData = {
        customerId,
        documentLanguage: language,
        invoiceDate: today,
        serviceDateFrom: today,
        serviceDateTo: null,
        paymentTermDays: profile.defaultPaymentTermDays,
        siteAddress: '',
        subject: '',
        introText: profile.introTexts[language],
        closingText: profile.closingTexts[language],
        positions: [],
      };
      const id = await createDraft(db, draft, profile.taxMode, currentAuth(request).user.id);
      return reply.code(201).send(await detail((await findInvoice(db, id))!));
    },
  );

  app.get(
    '/invoices/:id',
    {
      schema: {
        summary: 'Get an invoice with live totals and the § 14 check',
        tags: ['invoices'],
        params: IdParamsSchema,
        response: { 200: InvoiceDetail, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      const invoice = await findInvoice(db, request.params.id);
      return invoice ? detail(invoice) : reply.code(404).send(notFound);
    },
  );

  app.put(
    '/invoices/:id',
    {
      schema: {
        summary: 'Save a draft (auto-save). Only drafts can be changed (FR-INV-13).',
        tags: ['invoices'],
        params: IdParamsSchema,
        body: DraftBody,
        response: { 200: InvoiceDetail, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { version, ...data } = request.body as Static<typeof DraftBody>;
      if (
        ![data.invoiceDate, data.serviceDateFrom, data.serviceDateTo ?? data.serviceDateFrom].every(
          isIsoDate,
        )
      ) {
        return reply.code(400).send({ error: 'INVALID_DATE', message: 'Invalid date' });
      }
      const current = await findInvoice(db, id);
      if (!current) return reply.code(404).send(notFound);
      // Switching to another customer requires an active one; keeping an archived one is fine.
      if (data.customerId !== null && data.customerId !== current.customerId) {
        const customer = await checkCustomer(data.customerId);
        if ('error' in customer) return reply.code(400).send(customer);
      }
      const { profile } = await loadCompany(db);
      const result = await saveDraft(
        db,
        id,
        version,
        data,
        profile.taxMode,
        currentAuth(request).user.id,
      );
      if (result === 'not-found') return reply.code(404).send(notFound);
      if (result === 'not-editable') {
        return reply
          .code(409)
          .send({ error: 'INVOICE_NOT_EDITABLE', message: 'Finalized invoices cannot be changed' });
      }
      if (result === 'conflict') {
        return reply.code(409).send({
          error: 'INVOICE_CHANGED',
          message: 'The invoice was changed elsewhere; reload it',
        });
      }
      return detail((await findInvoice(db, id))!);
    },
  );

  app.delete(
    '/invoices/:id',
    {
      schema: {
        summary: 'Delete a draft (finalized invoices are never deleted, NFR-DATA-01)',
        tags: ['invoices'],
        params: IdParamsSchema,
        response: { 204: Type.Null(), ...errorResponses(401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const result = await deleteDraft(db, request.params.id);
      if (result === 'not-found') return reply.code(404).send(notFound);
      if (result === 'not-deletable') {
        return reply.code(409).send({
          error: 'INVOICE_NOT_DELETABLE',
          message: 'Only drafts can be deleted',
        });
      }
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/invoices/:id/finalize',
    {
      schema: {
        summary: 'Finalize ("Create PDF"): number, snapshots, stored PDF, status OPEN (FR-INV-11)',
        tags: ['invoices'],
        params: IdParamsSchema,
        body: Type.Object({ version: Type.Integer({ minimum: 1 }) }),
        response: { 200: InvoiceDetail, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const outcome = await finalizeInvoice(
        db,
        files,
        renderer,
        id,
        request.body.version,
        currentAuth(request).user.id,
      );
      switch (outcome.result) {
        case 'not-found':
          return reply.code(404).send(notFound);
        case 'not-editable':
          return reply
            .code(409)
            .send({ error: 'INVOICE_NOT_EDITABLE', message: 'Invoice is already finalized' });
        case 'conflict':
          return reply.code(409).send({
            error: 'INVOICE_CHANGED',
            message: 'The invoice was changed elsewhere; reload it',
          });
        case 'number-taken':
          return reply.code(409).send({
            error: 'NUMBER_TAKEN',
            message: 'The next invoice number is already used; raise the next number',
          });
        case 'incomplete':
          return reply.code(400).send({
            error: 'INVOICE_INCOMPLETE',
            message: 'Mandatory invoice data is missing',
            problems: outcome.problems,
          });
        case 'finalized':
          request.log.info({ invoiceId: id, number: outcome.number }, 'invoice finalized');
          return detail((await findInvoice(db, id))!);
      }
    },
  );

  /** FR-INV-15: the stored reference PDF, byte for byte – never re-rendered. */
  async function sendStoredPdf(invoice: StoredInvoice, reply: FastifyReply) {
    const row = invoice.pdfFileId ? await files.find(invoice.pdfFileId, 'INVOICE_PDF') : undefined;
    if (!row || !invoice.number || !invoice.buyerSnapshot) {
      return reply
        .code(409)
        .send({ error: 'INVOICE_NOT_FINALIZED', message: 'There is no PDF for this invoice yet' });
    }
    const name = invoiceFileName(
      translate(invoice.documentLanguage, 'pdf.filePrefix'),
      invoice.number,
      invoice.buyerSnapshot,
      invoice.invoiceDate,
    );
    return reply
      .type(row.mime_type)
      .header('Content-Disposition', contentDisposition(name))
      .header('Cache-Control', 'private, no-cache')
      .header('X-Content-Type-Options', 'nosniff')
      .send(await files.read(row));
  }

  app.get(
    '/invoices/:id/pdf',
    {
      schema: {
        summary: 'Download the stored PDF of a finalized invoice (byte-identical, FR-INV-15)',
        tags: ['invoices'],
        params: IdParamsSchema,
        produces: ['application/pdf'],
        response: { 200: BinarySchema, ...errorResponses(401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const invoice = await findInvoice(db, request.params.id);
      if (!invoice) return reply.code(404).send(notFound);
      return sendStoredPdf(invoice, reply);
    },
  );

  app.get(
    '/invoices/:id/preview',
    {
      schema: {
        summary: 'PDF preview: drafts with "ENTWURF" watermark and no number (FR-INV-12)',
        tags: ['invoices'],
        params: IdParamsSchema,
        produces: ['application/pdf'],
        response: { 200: BinarySchema, ...errorResponses(401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const invoice = await findInvoice(db, request.params.id);
      if (!invoice) return reply.code(404).send(notFound);
      if (invoice.status !== 'DRAFT') return sendStoredPdf(invoice, reply);
      const [{ profile }, customer, style] = await Promise.all([
        loadCompany(db),
        invoice.customerId ? findCustomer(db, invoice.customerId) : Promise.resolve(undefined),
        loadPrintStyle(db, files),
      ]);
      const document = buildInvoiceDocument({
        invoice,
        seller: sellerSnapshot(profile),
        buyer: customer ? buyerSnapshot(customer) : null,
        taxMode: profile.taxMode,
        style,
        watermark: translate(invoice.documentLanguage, 'pdf.draft'),
      });
      const pdf = await renderer.render(document);
      const name = `${translate(invoice.documentLanguage, 'pdf.draft')}.pdf`;
      return reply
        .type(renderer.mimeType)
        .header('Content-Disposition', contentDisposition(name))
        .header('Cache-Control', 'no-store')
        .send(pdf);
    },
  );

  app.post(
    '/invoices/:id/copy',
    {
      schema: {
        summary: 'Copy any invoice into a new draft (FR-INV-08)',
        tags: ['invoices'],
        params: IdParamsSchema,
        response: { 201: InvoiceDetail, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      const source = await findInvoice(db, request.params.id);
      if (!source) return reply.code(404).send(notFound);
      const { profile } = await loadCompany(db);
      const today = businessToday();
      const id = await createDraft(
        db,
        {
          ...source,
          // New dates and no number; content (customer, positions, texts) stays.
          invoiceDate: today,
          serviceDateFrom: today,
          serviceDateTo: null,
          positions: source.positions.map(({ lineTotalCents: _l, vatCategory: _v, ...p }) => p),
        },
        profile.taxMode,
        currentAuth(request).user.id,
      );
      return reply.code(201).send(await detail((await findInvoice(db, id))!));
    },
  );
};
