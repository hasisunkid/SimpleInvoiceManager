import {
  CATALOG_MATCH_THRESHOLD,
  CUSTOMER_MATCH_THRESHOLD,
  MAX_POSITIONS,
  MAX_QUANTITY_MILLI,
  MAX_UNIT_PRICE_CENTS,
  catalogPositionText,
  catalogSimilarity,
  customerDisplayName,
  customerSimilarity,
  formatDecimalAmount,
  formatDecimalQuantity,
  isIsoDate,
  parseDecimalAmount,
  parseDecimalQuantity,
  parseUnit,
  rankCandidates,
  validateCustomer,
  type CustomerData,
  type CustomerType,
  type InvoiceDraftData,
  type InvoicePositionData,
  type PositionType,
  type UnitCode,
  type VatRate,
} from '@sim/domain';
import type { Language } from '@sim/i18n';
import type { Db } from '../db.js';
import { findCatalogItem, insertCatalogItem, searchCatalog } from '../catalog/repository.js';
import { loadCompany } from '../company/repository.js';
import {
  customerCandidates,
  findCustomer,
  insertCustomer,
  type Customer,
} from '../customers/repository.js';
import type { InvoiceDetailView } from '../invoices/detail.js';
import type { Origin } from './origin.js';

/** A problem with what the assistant sent – reported back as a tool error it can fix. */
export class McpInputError extends Error {
  override readonly name = 'McpInputError';
}

// ------------------------------------------------------------------ customers (FR-MCP-05)

export interface CustomerInput {
  name: string;
  type: CustomerType;
  contactPerson?: string | undefined;
  street?: string | undefined;
  zip?: string | undefined;
  city?: string | undefined;
  countryCode?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  invoiceLanguage?: Language | undefined;
}

export interface CustomerRef {
  id: number;
  name: string;
  type: CustomerType;
  city: string;
  archived: boolean;
  aiCreated: boolean;
}

export function customerRef(c: Customer): CustomerRef {
  return {
    id: c.id,
    name: c.displayName,
    type: c.type,
    city: c.city,
    archived: c.archived,
    aiCreated: c.aiCreated,
  };
}

export interface CustomerResolution {
  customer: Customer;
  /** An existing similar customer is used (no new one created). */
  matched: boolean;
  created: boolean;
  /** Other similar active customers – the assistant may pass one as `customerId` instead. */
  alternatives: CustomerRef[];
  /** Similar archived customers: reported, never used (FR-MCP-05). */
  archivedMatches: CustomerRef[];
}

/**
 * FR-MCP-05 / D8 "prefer existing, otherwise create": the most similar active customer is
 * used; only when there is none, a new customer is created and marked as AI-created.
 */
export async function findOrCreateCustomer(
  db: Db,
  input: CustomerInput,
  userId: number,
  origin: Origin,
): Promise<CustomerResolution> {
  const name = input.name.trim();
  if (!name) throw new McpInputError('customer.name is required');
  const ranked = rankCandidates(
    await customerCandidates(db),
    (c) =>
      customerSimilarity(
        {
          name,
          type: input.type,
          ...(input.contactPerson ? { contactPerson: input.contactPerson } : {}),
          ...(input.zip ? { zip: input.zip } : {}),
          ...(input.city ? { city: input.city } : {}),
        },
        c,
      ),
    CUSTOMER_MATCH_THRESHOLD,
  );
  const load = async (ids: number[]) =>
    (await Promise.all(ids.map((id) => findCustomer(db, id)))).filter(
      (c): c is Customer => c !== undefined,
    );
  const active = ranked.filter((r) => !r.candidate.archived).map((r) => r.candidate.id);
  const archived = ranked.filter((r) => r.candidate.archived).map((r) => r.candidate.id);
  const archivedMatches = (await load(archived.slice(0, 5))).map(customerRef);

  if (active.length > 0) {
    const [best, ...others] = await load(active.slice(0, 6));
    return {
      customer: best!,
      matched: true,
      created: false,
      alternatives: others.map(customerRef),
      archivedMatches,
    };
  }

  const data: CustomerData = {
    type: input.type,
    companyName: input.type === 'BUSINESS' ? name : '',
    contactPerson: input.type === 'BUSINESS' ? (input.contactPerson ?? '').trim() : name,
    street: (input.street ?? '').trim(),
    zip: (input.zip ?? '').trim(),
    city: (input.city ?? '').trim(),
    countryCode: (input.countryCode ?? 'DE').trim().toUpperCase(),
    email: (input.email ?? '').trim(),
    phone: (input.phone ?? '').trim(),
    vatId: '',
    invoiceLanguage: input.invoiceLanguage ?? 'de',
    notes: '',
  };
  const problems = validateCustomer(data);
  const first = Object.entries(problems)[0];
  if (first) throw new McpInputError(`customer.${first[0]}: ${first[1]}`);
  const id = await insertCustomer(db, data, userId, origin);
  return {
    customer: (await findCustomer(db, id))!,
    matched: false,
    created: true,
    alternatives: [],
    archivedMatches,
  };
}

/** `customerId` (explicit) or customer data (lookup-or-create). */
export async function resolveCustomer(
  db: Db,
  input: { customerId?: number | undefined; customer?: CustomerInput | undefined },
  userId: number,
  origin: Origin,
): Promise<CustomerResolution> {
  if (input.customerId !== undefined) {
    const customer = await findCustomer(db, input.customerId);
    if (!customer) throw new McpInputError(`No customer with id ${input.customerId}`);
    if (customer.archived) {
      throw new McpInputError(`Customer ${input.customerId} is archived and cannot be used`);
    }
    return { customer, matched: true, created: false, alternatives: [], archivedMatches: [] };
  }
  if (!input.customer) throw new McpInputError('Pass either customerId or customer');
  return findOrCreateCustomer(db, input.customer, userId, origin);
}

// ------------------------------------------------------------------ positions (FR-MCP-08)

export interface PositionInput {
  title: string;
  description?: string | undefined;
  type: PositionType;
  quantity?: string | undefined;
  unit?: string | undefined;
  unitPrice?: string | undefined;
  vatRate?: VatRate | undefined;
  catalogItemId?: number | undefined;
}

export interface CatalogRef {
  id: number;
  title: string;
  unit: UnitCode;
  unitPrice: string;
}

export interface PositionResolution {
  position: number;
  catalogItemId: number;
  catalogTitle: string;
  /** An existing similar catalogue entry was used. */
  matched: boolean;
  /** A new catalogue entry was created (marked AI-created). */
  created: boolean;
  /** The stated price differs from the catalogue price – used in this invoice only. */
  priceOverridden: boolean;
  alternatives: CatalogRef[];
}

interface ParsedPosition {
  input: PositionInput;
  quantityMilli: number;
  unitCode: UnitCode | null;
  unitPriceCents: number | null;
}

function parsePosition(p: PositionInput, n: number): ParsedPosition {
  const where = `positions[${n}]`;
  if (!p.title.trim()) throw new McpInputError(`${where}.title is required`);
  const quantityMilli = parseDecimalQuantity(p.quantity ?? '1');
  if (quantityMilli === null || quantityMilli <= 0 || quantityMilli > MAX_QUANTITY_MILLI) {
    throw new McpInputError(
      `${where}.quantity "${p.quantity}" is invalid – use a decimal string like "2.5"`,
    );
  }
  let unitCode: UnitCode | null = null;
  if (p.unit !== undefined && p.unit.trim() !== '') {
    unitCode = parseUnit(p.unit);
    if (!unitCode) {
      throw new McpInputError(
        `${where}.unit "${p.unit}" is unknown – use HUR (hour), H87 (piece), MTR (m), ` +
          `MTK (m²), MTQ (m³), KGM (kg) or LS (lump sum)`,
      );
    }
  }
  let unitPriceCents: number | null = null;
  if (p.unitPrice !== undefined) {
    unitPriceCents = parseDecimalAmount(p.unitPrice);
    if (unitPriceCents === null || unitPriceCents > MAX_UNIT_PRICE_CENTS) {
      throw new McpInputError(
        `${where}.unitPrice "${p.unitPrice}" is invalid – net euros as a decimal string like "48.00"`,
      );
    }
  }
  return { input: p, quantityMilli, unitCode, unitPriceCents };
}

/** Unit for a new catalogue entry when none was stated. */
function defaultUnit(p: ParsedPosition): UnitCode {
  if (p.quantityMilli === 1000) return 'LS';
  return p.input.type === 'WORK' ? 'HUR' : 'H87';
}

/**
 * FR-MCP-08 / D8 for every position: explicit `catalogItemId`, else the most similar active
 * catalogue entry (same type, compatible unit), else a new entry marked as AI-created. The
 * values are copied into the invoice (FR-CAT-03); a stated price or quantity applies to this
 * invoice only – the catalogue entry is never changed.
 *
 * All positions are checked before anything is created, so a bad position creates nothing.
 */
export async function resolvePositions(
  db: Db,
  inputs: readonly PositionInput[],
  userId: number,
  origin: Origin,
  startIndex = 1,
): Promise<{ positions: InvoicePositionData[]; resolutions: PositionResolution[] }> {
  if (inputs.length === 0) throw new McpInputError('At least one position is required');
  const parsed = inputs.map((p, i) => parsePosition(p, i));
  const { profile } = await loadCompany(db);
  const catalog = await searchCatalog(db, {});

  type Plan =
    | { kind: 'existing'; id: number; alternatives: CatalogRef[] }
    | { kind: 'new'; parsed: ParsedPosition }
    /** Same as a new entry planned earlier in this request – no twin is created. */
    | { kind: 'same'; as: number };
  const plans: Plan[] = [];
  /** New entries planned so far, as candidates for later positions (id = plan index). */
  const planned: {
    id: number;
    type: PositionType;
    title: string;
    description: string;
    unitCode: UnitCode;
  }[] = [];
  for (const [i, p] of parsed.entries()) {
    if (p.input.catalogItemId !== undefined) {
      const item = await findCatalogItem(db, p.input.catalogItemId);
      if (!item || !item.active) {
        throw new McpInputError(`positions[${i}].catalogItemId ${p.input.catalogItemId} not found`);
      }
      plans.push({ kind: 'existing', id: item.id, alternatives: [] });
      continue;
    }
    const ranked = rankCandidates(
      catalog,
      (c) =>
        catalogSimilarity(
          {
            type: p.input.type,
            title: p.input.title,
            ...(p.unitCode ? { unitCode: p.unitCode } : {}),
          },
          c,
        ),
      CATALOG_MATCH_THRESHOLD,
    );
    const lookup = {
      type: p.input.type,
      title: p.input.title,
      ...(p.unitCode ? { unitCode: p.unitCode } : {}),
    };
    const [best, ...others] = ranked;
    const twin = best
      ? undefined
      : rankCandidates(planned, (c) => catalogSimilarity(lookup, c), CATALOG_MATCH_THRESHOLD)[0];
    if (twin) {
      plans.push({ kind: 'same', as: twin.candidate.id });
    } else if (best) {
      plans.push({
        kind: 'existing',
        id: best.candidate.id,
        alternatives: others.slice(0, 5).map(({ candidate: c }) => ({
          id: c.id,
          title: c.title,
          unit: c.unitCode,
          unitPrice: formatDecimalAmount(c.unitPriceCents),
        })),
      });
    } else {
      if (p.unitPriceCents === null) {
        throw new McpInputError(
          `positions[${i}] "${p.input.title}": no similar catalogue entry exists, so unitPrice ` +
            `is required to create one`,
        );
      }
      plans.push({ kind: 'new', parsed: p });
      planned.push({
        id: i,
        type: p.input.type,
        title: p.input.title,
        description: p.input.description ?? '',
        unitCode: p.unitCode ?? defaultUnit(p),
      });
    }
  }
  /** Catalogue ids of the entries created for 'new' plans, by plan index. */
  const createdIds = new Map<number, number>();

  const positions: InvoicePositionData[] = [];
  const resolutions: PositionResolution[] = [];
  for (const [i, plan] of plans.entries()) {
    const p = parsed[i]!;
    let itemId: number;
    let created = false;
    if (plan.kind === 'new') {
      itemId = await insertCatalogItem(
        db,
        {
          type: p.input.type,
          title: p.input.title.trim().slice(0, 120),
          description: (p.input.description ?? '').trim(),
          unitCode: p.unitCode ?? defaultUnit(p),
          unitPriceCents: p.unitPriceCents!,
          vatRate: p.input.vatRate ?? profile.defaultVatRate,
          active: true,
        },
        userId,
        origin,
      );
      created = true;
      createdIds.set(i, itemId);
    } else if (plan.kind === 'same') {
      itemId = createdIds.get(plan.as)!;
    } else {
      itemId = plan.id;
    }
    const item = (await findCatalogItem(db, itemId))!;
    const description = p.input.description?.trim();
    positions.push({
      type: item.type,
      description: catalogPositionText({
        title: item.title,
        description:
          description !== undefined && description !== '' ? description : item.description,
      }).slice(0, 4000),
      quantityMilli: p.quantityMilli,
      unitCode: p.unitCode ?? item.unitCode,
      unitPriceCents: p.unitPriceCents ?? item.unitPriceCents,
      vatRate: p.input.vatRate ?? item.vatRate,
    });
    resolutions.push({
      position: startIndex + i,
      catalogItemId: item.id,
      catalogTitle: item.title,
      matched: !created,
      created,
      priceOverridden: p.unitPriceCents !== null && p.unitPriceCents !== item.unitPriceCents,
      alternatives: plan.kind === 'existing' ? plan.alternatives : [],
    });
  }
  if (positions.length > MAX_POSITIONS) {
    throw new McpInputError(`An invoice can have at most ${MAX_POSITIONS} positions`);
  }
  return { positions, resolutions };
}

// ------------------------------------------------------------------ header fields

export interface DraftChanges {
  invoiceDate?: string | undefined;
  serviceDateFrom?: string | undefined;
  serviceDateTo?: string | null | undefined;
  paymentTermDays?: number | undefined;
  documentLanguage?: Language | undefined;
  subject?: string | undefined;
  siteAddress?: string | undefined;
  introText?: string | undefined;
  closingText?: string | undefined;
}

/** Applies header changes to a draft and checks the dates (FR-INV-01, FR-INV-02). */
export function applyChanges(draft: InvoiceDraftData, changes: DraftChanges): InvoiceDraftData {
  for (const key of ['invoiceDate', 'serviceDateFrom', 'serviceDateTo'] as const) {
    const value = changes[key];
    if (typeof value === 'string' && !isIsoDate(value)) {
      throw new McpInputError(`${key} "${value}" is not a valid date (YYYY-MM-DD)`);
    }
  }
  const invoiceDate = changes.invoiceDate ?? draft.invoiceDate;
  const next: InvoiceDraftData = {
    ...draft,
    invoiceDate,
    // FR-INV-02: the service date follows a changed invoice date unless stated.
    serviceDateFrom:
      changes.serviceDateFrom ??
      (changes.invoiceDate && draft.serviceDateFrom === draft.invoiceDate
        ? invoiceDate
        : draft.serviceDateFrom),
    serviceDateTo:
      changes.serviceDateTo === undefined ? draft.serviceDateTo : changes.serviceDateTo,
    ...(changes.paymentTermDays !== undefined ? { paymentTermDays: changes.paymentTermDays } : {}),
    ...(changes.documentLanguage ? { documentLanguage: changes.documentLanguage } : {}),
    ...(changes.subject !== undefined ? { subject: changes.subject } : {}),
    ...(changes.siteAddress !== undefined ? { siteAddress: changes.siteAddress } : {}),
    ...(changes.introText !== undefined ? { introText: changes.introText } : {}),
    ...(changes.closingText !== undefined ? { closingText: changes.closingText } : {}),
  };
  if (next.serviceDateTo !== null && next.serviceDateTo < next.serviceDateFrom) {
    throw new McpInputError('serviceDateTo must not be before serviceDateFrom');
  }
  return next;
}

/** Editable content of a stored draft (drops calculated fields). */
export function draftData(invoice: InvoiceDetailView): InvoiceDraftData {
  return {
    customerId: invoice.customerId,
    documentLanguage: invoice.documentLanguage,
    invoiceDate: invoice.invoiceDate,
    serviceDateFrom: invoice.serviceDateFrom,
    serviceDateTo: invoice.serviceDateTo,
    paymentTermDays: invoice.paymentTermDays,
    siteAddress: invoice.siteAddress,
    subject: invoice.subject,
    introText: invoice.introText,
    closingText: invoice.closingText,
    positions: invoice.positions.map((p) => ({
      type: p.type,
      description: p.description,
      quantityMilli: p.quantityMilli,
      unitCode: p.unitCode,
      unitPriceCents: p.unitPriceCents,
      vatRate: p.vatRate,
    })),
  };
}

// ------------------------------------------------------------------ output for the assistant

const money = formatDecimalAmount;

/** Compact, machine-friendly view of an invoice for tool results (amounts as "1755.00"). */
export function invoiceSummary(invoice: InvoiceDetailView, link: string) {
  return {
    id: invoice.id,
    version: invoice.version,
    status: invoice.status,
    number: invoice.number,
    link,
    aiCreated: invoice.aiCreated,
    customer: invoice.customer
      ? { id: invoice.customer.id, name: customerDisplayName(invoice.customer) }
      : null,
    documentLanguage: invoice.documentLanguage,
    invoiceDate: invoice.invoiceDate,
    serviceDateFrom: invoice.serviceDateFrom,
    serviceDateTo: invoice.serviceDateTo,
    paymentTermDays: invoice.paymentTermDays,
    dueDate: invoice.dueDate,
    subject: invoice.subject,
    siteAddress: invoice.siteAddress,
    taxMode: invoice.taxMode,
    positions: invoice.positions.map((p, i) => ({
      index: i + 1,
      type: p.type,
      description: p.description,
      quantity: formatDecimalQuantity(p.quantityMilli),
      unit: p.unitCode,
      unitPrice: money(p.unitPriceCents),
      vatRate: p.vatRate,
      lineTotal: money(p.lineTotalCents),
    })),
    totals: {
      net: money(invoice.totals.netCents),
      vat: money(invoice.totals.vatCents),
      gross: money(invoice.totals.grossCents),
      vatGroups: invoice.totals.vatGroups.map((g) => ({
        rate: g.rate,
        net: money(g.netCents),
        vat: money(g.vatCents),
      })),
      work: money(invoice.totals.sections.WORK.netCents),
      material: money(invoice.totals.sections.MATERIAL.netCents),
      labourCostInclVat: money(invoice.totals.labourCostInclVatCents),
    },
    /** FR-INV-07: what a person still has to complete before creating the PDF. */
    missingForFinalize: invoice.finalizeProblems,
  };
}
