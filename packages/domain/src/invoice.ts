import { MAX_QUANTITY_MILLI } from './calculation.js';
import { MAX_UNIT_PRICE_CENTS } from './catalog.js';
import { missingForFinalize, type CompanyProfile, type VatRate } from './company.js';
import { missingCustomerAddress, type CustomerData } from './customer.js';
import { addDays, isIsoDate, type IsoDate } from './date.js';
import type { DocumentLanguage } from './money.js';
import type { PositionType, UnitCode } from './units.js';

/** FR-INV-10: lifecycle states. "Overdue" is derived, not stored. */
export const INVOICE_STATUSES = ['DRAFT', 'OPEN', 'PAID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Maximum number of positions per invoice (keeps PDFs and requests reasonable). */
export const MAX_POSITIONS = 200;

export interface InvoicePositionData {
  readonly type: PositionType;
  readonly description: string;
  readonly quantityMilli: number;
  readonly unitCode: UnitCode;
  readonly unitPriceCents: number;
  readonly vatRate: VatRate;
}

/** Editable content of an invoice (FR-INV-01). */
export interface InvoiceDraftData {
  readonly customerId: number | null;
  readonly documentLanguage: DocumentLanguage;
  readonly invoiceDate: IsoDate;
  readonly serviceDateFrom: IsoDate;
  /** Null = single service date; otherwise the end of the service period. */
  readonly serviceDateTo: IsoDate | null;
  readonly paymentTermDays: number;
  readonly siteAddress: string;
  readonly subject: string;
  readonly introText: string;
  readonly closingText: string;
  readonly positions: readonly InvoicePositionData[];
}

export function dueDate(invoiceDate: IsoDate, paymentTermDays: number): IsoDate {
  return addDays(invoiceDate, paymentTermDays);
}

/** FR-INV-10: an open invoice whose due date has passed. */
export function isOverdue(status: InvoiceStatus, due: IsoDate, today: IsoDate): boolean {
  return status === 'OPEN' && due < today;
}

export type PositionProblem = 'INVALID_QUANTITY' | 'INVALID_PRICE';

/** Problems that make a draft unsavable (as opposed to not yet finalizable). */
export function positionProblems(p: InvoicePositionData): PositionProblem[] {
  const problems: PositionProblem[] = [];
  if (
    !Number.isSafeInteger(p.quantityMilli) ||
    p.quantityMilli <= 0 ||
    p.quantityMilli > MAX_QUANTITY_MILLI
  ) {
    problems.push('INVALID_QUANTITY');
  }
  if (
    !Number.isSafeInteger(p.unitPriceCents) ||
    p.unitPriceCents < 0 ||
    p.unitPriceCents > MAX_UNIT_PRICE_CENTS
  ) {
    problems.push('INVALID_PRICE');
  }
  return problems;
}

/**
 * FR-INV-07: what is missing for a legally complete invoice (§ 14 Abs. 4 UStG). The invoice
 * number is assigned on finalize, the tax amounts are calculated – so the remaining checks are
 * seller and buyer data, dates, and quantity + description of every position.
 */
export type FinalizeProblem =
  | 'COMPANY_INCOMPLETE'
  | 'CUSTOMER_MISSING'
  | 'CUSTOMER_ADDRESS_INCOMPLETE'
  | 'CUSTOMER_ARCHIVED'
  | 'NO_POSITIONS'
  | 'POSITION_DESCRIPTION_MISSING'
  | 'INVALID_DATE'
  | 'SERVICE_PERIOD_INVALID';

export function finalizeProblems(
  draft: InvoiceDraftData,
  customer: (CustomerData & { archived: boolean }) | null,
  company: CompanyProfile,
): FinalizeProblem[] {
  const problems: FinalizeProblem[] = [];
  if (missingForFinalize(company).length > 0) problems.push('COMPANY_INCOMPLETE');
  if (!customer) problems.push('CUSTOMER_MISSING');
  else {
    if (missingCustomerAddress(customer).length > 0) problems.push('CUSTOMER_ADDRESS_INCOMPLETE');
    if (customer.archived) problems.push('CUSTOMER_ARCHIVED');
  }
  if (draft.positions.length === 0) problems.push('NO_POSITIONS');
  if (draft.positions.some((p) => !p.description.trim())) {
    problems.push('POSITION_DESCRIPTION_MISSING');
  }
  if (
    !isIsoDate(draft.invoiceDate) ||
    !isIsoDate(draft.serviceDateFrom) ||
    (draft.serviceDateTo !== null && !isIsoDate(draft.serviceDateTo))
  ) {
    problems.push('INVALID_DATE');
  } else if (draft.serviceDateTo !== null && draft.serviceDateTo < draft.serviceDateFrom) {
    problems.push('SERVICE_PERIOD_INVALID');
  }
  return problems;
}

/**
 * Short customer name for file names, as in the reference files ("Illing", "Karaca"): the
 * person's last name – for private customers from the name, for businesses from the contact
 * person – otherwise the first word of the company name.
 */
export function customerShortName(buyer: {
  type: 'BUSINESS' | 'PRIVATE';
  name: string;
  attention: string;
}): string {
  const person = (buyer.type === 'PRIVATE' ? buyer.name : buyer.attention)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (person.length > 0) return person[person.length - 1]!;
  return buyer.name.trim().split(/\s+/)[0] ?? '';
}

/** Keeps letters (incl. ä, ł …), digits, "-" and "."; everything else becomes "-". */
function safeFilePart(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}.-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/**
 * FR-PDF-04: `RechnungsNr_{number}_{customerShortName}_{dd.MM.yyyy}.pdf`; the prefix is localised
 * by the caller ("RechnungsNr", "Faktura", "Invoice").
 */
export function invoiceFileName(
  prefix: string,
  number: string,
  buyer: { type: 'BUSINESS' | 'PRIVATE'; name: string; attention: string },
  invoiceDate: IsoDate,
): string {
  const [y, m, d] = invoiceDate.split('-');
  const parts = [prefix, number, customerShortName(buyer), `${d}.${m}.${y}`]
    .map(safeFilePart)
    .filter(Boolean);
  return `${parts.join('_')}.pdf`;
}
