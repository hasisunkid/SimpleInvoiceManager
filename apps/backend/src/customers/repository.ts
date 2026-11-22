import type { Knex } from 'knex';
import { customerDisplayName, type CustomerData, type CustomerType } from '@sim/domain';
import type { Language } from '@sim/i18n';
import type { Db } from '../db.js';
import {
  aiCreatedSql,
  isAiCreated,
  originColumns,
  reviewedColumn,
  UI_ORIGIN,
  type Origin,
} from '../mcp/origin.js';

interface CustomerRow {
  id: number;
  type: CustomerType;
  company_name: string;
  contact_person: string;
  street: string;
  zip: string;
  city: string;
  country_code: string;
  email: string;
  phone: string;
  vat_id: string;
  invoice_language: Language;
  notes: string;
  archived: number | boolean;
  created_via: 'UI' | 'MCP';
  ai_reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Customer extends CustomerData {
  id: number;
  displayName: string;
  archived: boolean;
  /** FR-MCP-10: created by an AI assistant and not yet checked by a person. */
  aiCreated: boolean;
  createdAt: string;
  updatedAt: string;
}

function toCustomer(row: CustomerRow): Customer {
  const data: CustomerData = {
    type: row.type,
    companyName: row.company_name,
    contactPerson: row.contact_person,
    street: row.street,
    zip: row.zip,
    city: row.city,
    countryCode: row.country_code,
    email: row.email,
    phone: row.phone,
    vatId: row.vat_id,
    invoiceLanguage: row.invoice_language,
    notes: row.notes,
  };
  return {
    id: row.id,
    ...data,
    displayName: customerDisplayName(data),
    archived: Boolean(row.archived),
    aiCreated: isAiCreated(row),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toRow(c: CustomerData) {
  return {
    type: c.type,
    company_name: c.companyName,
    contact_person: c.contactPerson,
    street: c.street,
    zip: c.zip,
    city: c.city,
    country_code: c.countryCode,
    email: c.email,
    phone: c.phone,
    vat_id: c.vatId,
    invoice_language: c.invoiceLanguage,
    notes: c.notes,
  };
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** Splits a search query into terms; each term must match one of the searched columns. */
export function searchTerms(query: string | undefined): string[] {
  return (query ?? '')
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .slice(0, 5);
}

export interface CustomerQuery {
  q?: string;
  includeArchived?: boolean;
  /** FR-MCP-10 filter "Von KI erstellt". */
  aiCreated?: boolean;
  limit: number;
  offset: number;
}

/**
 * FR-CUST-02: search as you type over name, company, contact person and city. Queries shorter
 * than two characters list everything. Case- and accent-insensitive via the column collation.
 */
export async function searchCustomers(
  db: Db,
  { q, includeArchived = false, aiCreated = false, limit, offset }: CustomerQuery,
): Promise<{ items: Customer[]; total: number }> {
  const terms = (q ?? '').trim().length >= 2 ? searchTerms(q) : [];
  const base = db<CustomerRow>('customer').modify((query) => {
    if (!includeArchived) query.where('archived', false);
    if (aiCreated) query.whereRaw(aiCreatedSql());
    for (const term of terms) {
      const pattern = likePattern(term);
      query.where((w) =>
        w
          .where('company_name', 'like', pattern)
          .orWhere('contact_person', 'like', pattern)
          .orWhere('city', 'like', pattern),
      );
    }
  });
  const [rows, countRow] = await Promise.all([
    base
      .clone()
      .select('*')
      .orderByRaw("COALESCE(NULLIF(company_name, ''), contact_person), id")
      .limit(limit)
      .offset(offset),
    base.clone().count<{ n: number | string }[]>({ n: '*' }).first(),
  ]);
  return { items: rows.map(toCustomer), total: Number(countRow?.n ?? 0) };
}

export async function findCustomer(
  db: Db | Knex.Transaction,
  id: number,
): Promise<Customer | undefined> {
  const row = await db<CustomerRow>('customer').where({ id }).first();
  return row ? toCustomer(row) : undefined;
}

export async function insertCustomer(
  db: Db,
  c: CustomerData,
  userId: number | null,
  origin: Origin = UI_ORIGIN,
): Promise<number> {
  const [id] = await db('customer').insert({
    ...toRow(c),
    ...originColumns(origin),
    created_by: userId,
    updated_by: userId,
  });
  return id as number;
}

export async function updateCustomer(
  db: Db,
  id: number,
  c: CustomerData,
  userId: number,
): Promise<boolean> {
  const n = await db('customer')
    .where({ id })
    // A person edited and saved it: no longer "Von KI erstellt" (FR-MCP-10).
    .update({ ...toRow(c), ...reviewedColumn(db), updated_by: userId, updated_at: new Date() });
  return n > 0;
}

/** FR-MCP-10: a person confirmed the AI-created customer ("Geprüft"). */
export async function markCustomerReviewed(db: Db, id: number, userId: number): Promise<boolean> {
  const n = await db('customer')
    .where({ id })
    .update({ ...reviewedColumn(db), updated_by: userId, updated_at: new Date() });
  return n > 0;
}

/** Lightweight rows for the MCP similarity lookup (FR-MCP-05) – all customers, incl. archived. */
export async function customerCandidates(db: Db) {
  const rows = await db<CustomerRow>('customer').select(
    'id',
    'type',
    'company_name',
    'contact_person',
    'zip',
    'city',
    'archived',
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    companyName: r.company_name,
    contactPerson: r.contact_person,
    zip: r.zip,
    city: r.city,
    archived: Boolean(r.archived),
  }));
}

export async function setCustomerArchived(
  db: Db,
  id: number,
  archived: boolean,
  userId: number,
): Promise<boolean> {
  const n = await db('customer')
    .where({ id })
    .update({ archived, updated_by: userId, updated_at: new Date() });
  return n > 0;
}

/** MariaDB refuses to delete a row that is still referenced by a foreign key (e.g. invoices). */
export function isReferencedError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ER_ROW_IS_REFERENCED_2' || code === 'ER_ROW_IS_REFERENCED';
}

export async function deleteCustomer(db: Db, id: number): Promise<boolean> {
  return (await db('customer').where({ id }).delete()) > 0;
}
