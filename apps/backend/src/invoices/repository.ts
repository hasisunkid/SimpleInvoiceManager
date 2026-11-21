import type { Knex } from 'knex';
import {
  calculateInvoice,
  dueDate,
  type BuyerSnapshot,
  type SellerSnapshot,
  type InvoiceDraftData,
  type InvoicePositionData,
  type InvoiceStatus,
  type InvoiceTotals,
  type PositionType,
  type TaxMode,
  type UnitCode,
  type VatCategory,
  type VatRate,
} from '@sim/domain';
import type { Language } from '@sim/i18n';
import { transactionWithRetry, type Db } from '../db.js';

type Executor = Db | Knex.Transaction;

interface InvoiceRow {
  id: number;
  number: string | null;
  status: InvoiceStatus;
  customer_id: number | null;
  document_language: Language;
  invoice_date: string;
  service_date_from: string;
  service_date_to: string | null;
  payment_term_days: number;
  due_date: string;
  site_address: string;
  subject: string;
  intro_text: string;
  closing_text: string;
  tax_mode: TaxMode;
  net_total_cents: number;
  vat_total_cents: number;
  gross_total_cents: number;
  labour_incl_vat_cents: number;
  seller_snapshot: string | object | null;
  buyer_snapshot: string | object | null;
  pdf_file_id: number | null;
  paid_at: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface PositionRow {
  id: number;
  invoice_id: number;
  sort_order: number;
  type: PositionType;
  description: string;
  quantity_milli: number;
  unit_code: UnitCode;
  unit_price_cents: number;
  vat_rate: VatRate;
  vat_category_code: VatCategory;
  line_total_cents: number;
}

export interface StoredPosition extends InvoicePositionData {
  lineTotalCents: number;
  vatCategory: VatCategory;
}

export interface StoredInvoice extends Omit<InvoiceDraftData, 'positions'> {
  id: number;
  number: string | null;
  status: InvoiceStatus;
  taxMode: TaxMode;
  dueDate: string;
  paidAt: string | null;
  version: number;
  /** Frozen on finalize (FR-COMP-05); null for drafts. */
  sellerSnapshot: SellerSnapshot | null;
  buyerSnapshot: BuyerSnapshot | null;
  /** The stored reference PDF (FR-INV-15); null for drafts. */
  pdfFileId: number | null;
  positions: StoredPosition[];
  totals: {
    netCents: number;
    vatCents: number;
    grossCents: number;
    labourCostInclVatCents: number;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * MariaDB's JSON type is LONGTEXT; depending on the driver's column detection it arrives as a
 * string or as an already parsed object – accept both.
 */
function parseJson<T>(value: string | T | null): T | null {
  if (value === null) return null;
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function toInvoice(row: InvoiceRow, positions: PositionRow[]): StoredInvoice {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    customerId: row.customer_id,
    documentLanguage: row.document_language,
    invoiceDate: row.invoice_date,
    serviceDateFrom: row.service_date_from,
    serviceDateTo: row.service_date_to,
    paymentTermDays: row.payment_term_days,
    dueDate: row.due_date,
    siteAddress: row.site_address,
    subject: row.subject,
    introText: row.intro_text,
    closingText: row.closing_text,
    taxMode: row.tax_mode,
    paidAt: row.paid_at,
    version: row.version,
    sellerSnapshot: parseJson(row.seller_snapshot as string | SellerSnapshot | null),
    buyerSnapshot: parseJson(row.buyer_snapshot as string | BuyerSnapshot | null),
    pdfFileId: row.pdf_file_id,
    positions: positions.map((p) => ({
      type: p.type,
      description: p.description,
      quantityMilli: p.quantity_milli,
      unitCode: p.unit_code,
      unitPriceCents: p.unit_price_cents,
      vatRate: p.vat_rate,
      vatCategory: p.vat_category_code,
      lineTotalCents: Number(p.line_total_cents),
    })),
    totals: {
      netCents: Number(row.net_total_cents),
      vatCents: Number(row.vat_total_cents),
      grossCents: Number(row.gross_total_cents),
      labourCostInclVatCents: Number(row.labour_incl_vat_cents),
    },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function findInvoice(
  db: Executor,
  id: number,
  { forUpdate = false } = {},
): Promise<StoredInvoice | undefined> {
  const query = db<InvoiceRow>('invoice').where({ id });
  if (forUpdate) query.forUpdate();
  const row = await query.first();
  if (!row) return undefined;
  const positions = await db<PositionRow>('invoice_position')
    .where({ invoice_id: id })
    .orderBy('sort_order');
  return toInvoice(row, positions);
}

/** Header columns and calculated amounts (FR-INV-06) for a draft. */
function draftColumns(data: InvoiceDraftData, taxMode: TaxMode, totals: InvoiceTotals) {
  return {
    customer_id: data.customerId,
    document_language: data.documentLanguage,
    invoice_date: data.invoiceDate,
    service_date_from: data.serviceDateFrom,
    service_date_to: data.serviceDateTo,
    payment_term_days: data.paymentTermDays,
    due_date: dueDate(data.invoiceDate, data.paymentTermDays),
    site_address: data.siteAddress,
    subject: data.subject,
    intro_text: data.introText,
    closing_text: data.closingText,
    tax_mode: taxMode,
    net_total_cents: totals.netCents,
    vat_total_cents: totals.vatCents,
    gross_total_cents: totals.grossCents,
    labour_incl_vat_cents: totals.labourCostInclVatCents,
  };
}

export async function replacePositions(
  trx: Knex.Transaction,
  invoiceId: number,
  positions: ReturnType<typeof calculateInvoice<InvoicePositionData>>['positions'],
): Promise<void> {
  await trx('invoice_position').where({ invoice_id: invoiceId }).delete();
  if (positions.length === 0) return;
  await trx('invoice_position').insert(
    positions.map((p, index) => ({
      invoice_id: invoiceId,
      sort_order: index + 1,
      type: p.type,
      description: p.description,
      quantity_milli: p.quantityMilli,
      unit_code: p.unitCode,
      unit_price_cents: p.unitPriceCents,
      vat_rate: p.vatRate,
      vat_category_code: p.vatCategory,
      line_total_cents: p.lineTotalCents,
    })),
  );
}

export async function recordStatus(
  trx: Executor,
  invoiceId: number,
  from: InvoiceStatus | null,
  to: InvoiceStatus,
  userId: number,
  note: string | null = null,
): Promise<void> {
  await trx('invoice_status_history').insert({
    invoice_id: invoiceId,
    from_status: from,
    to_status: to,
    user_id: userId,
    note,
  });
}

export async function createDraft(
  db: Db,
  data: InvoiceDraftData,
  taxMode: TaxMode,
  userId: number,
): Promise<number> {
  return transactionWithRetry(db, async (trx) => {
    const { positions, totals } = calculateInvoice(data.positions, taxMode);
    const [id] = await trx('invoice').insert({
      ...draftColumns(data, taxMode, totals),
      status: 'DRAFT',
      created_by: userId,
      updated_by: userId,
    });
    await replacePositions(trx, id as number, positions);
    await recordStatus(trx, id as number, null, 'DRAFT', userId);
    return id as number;
  });
}

export type SaveResult = 'saved' | 'not-found' | 'not-editable' | 'conflict';

/**
 * Saves a draft (auto-save). The row is locked and its version compared, so a stale save from a
 * second device cannot overwrite newer content (409 INVOICE_CHANGED). Only drafts are editable
 * (FR-INV-13).
 */
export async function saveDraft(
  db: Db,
  id: number,
  expectedVersion: number,
  data: InvoiceDraftData,
  taxMode: TaxMode,
  userId: number,
): Promise<SaveResult> {
  return transactionWithRetry(db, async (trx) => {
    const row = await trx<InvoiceRow>('invoice')
      .select('status', 'version')
      .where({ id })
      .forUpdate()
      .first();
    if (!row) return 'not-found';
    if (row.status !== 'DRAFT') return 'not-editable';
    if (row.version !== expectedVersion) return 'conflict';
    const { positions, totals } = calculateInvoice(data.positions, taxMode);
    await trx('invoice')
      .where({ id })
      .update({
        ...draftColumns(data, taxMode, totals),
        version: row.version + 1,
        updated_by: userId,
        updated_at: new Date(),
      });
    await replacePositions(trx, id, positions);
    return 'saved';
  });
}

/** FR-INV-13: only drafts can be deleted; finalized invoices are kept (NFR-DATA-01). */
export async function deleteDraft(
  db: Db,
  id: number,
): Promise<'deleted' | 'not-found' | 'not-deletable'> {
  return db.transaction(async (trx) => {
    const row = await trx<InvoiceRow>('invoice').select('status').where({ id }).forUpdate().first();
    if (!row) return 'not-found';
    if (row.status !== 'DRAFT') return 'not-deletable';
    await trx('invoice').where({ id }).delete();
    return 'deleted';
  });
}

export interface InvoiceListItem {
  id: number;
  number: string | null;
  status: InvoiceStatus;
  customerId: number | null;
  customerName: string;
  invoiceDate: string;
  dueDate: string;
  grossCents: number;
}

export interface InvoiceListQuery {
  status?: InvoiceStatus;
  customerId?: number;
  limit: number;
  offset: number;
}

/**
 * Invoice list (basic version; filters, search and sorting are extended in M6). The customer
 * name comes from the frozen buyer snapshot for finalized invoices, otherwise from the customer.
 */
export async function listInvoices(
  db: Db,
  { status, customerId, limit, offset }: InvoiceListQuery,
): Promise<{ items: InvoiceListItem[]; total: number; openTotalCents: number }> {
  const base = db('invoice as i')
    .leftJoin('customer as c', 'c.id', 'i.customer_id')
    .modify((q) => {
      if (status) q.where('i.status', status);
      if (customerId) q.where('i.customer_id', customerId);
    });
  const nameSql =
    "COALESCE(JSON_VALUE(i.buyer_snapshot, '$.name'), NULLIF(c.company_name, ''), c.contact_person, '')";
  const [rows, countRow, openRow] = await Promise.all([
    base
      .clone()
      .select(
        'i.id',
        'i.number',
        'i.status',
        'i.customer_id',
        'i.invoice_date',
        'i.due_date',
        'i.gross_total_cents',
        db.raw(`${nameSql} as customer_name`),
      )
      .orderBy([
        { column: 'i.invoice_date', order: 'desc' },
        { column: 'i.id', order: 'desc' },
      ])
      .limit(limit)
      .offset(offset),
    base.clone().count<{ n: number | string }[]>({ n: '*' }).first(),
    base
      .clone()
      .where('i.status', 'OPEN')
      .sum<{ s: number | string | null }[]>({ s: 'i.gross_total_cents' })
      .first(),
  ]);
  return {
    items: (rows as Record<string, unknown>[]).map((r) => ({
      id: r.id as number,
      number: r.number as string | null,
      status: r.status as InvoiceStatus,
      customerId: r.customer_id as number | null,
      customerName: String(r.customer_name ?? ''),
      invoiceDate: r.invoice_date as string,
      dueDate: r.due_date as string,
      grossCents: Number(r.gross_total_cents),
    })),
    total: Number(countRow?.n ?? 0),
    openTotalCents: Number(openRow?.s ?? 0),
  };
}
