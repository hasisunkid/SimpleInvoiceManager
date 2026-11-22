import {
  calculateInvoice,
  finalizeProblems,
  isOverdue,
  type InvoiceDraftData,
  type TaxMode,
} from '@sim/domain';
import type { Language } from '@sim/i18n';
import type { Db } from '../db.js';
import { loadCompany } from '../company/repository.js';
import { findCustomer, type Customer } from '../customers/repository.js';
import { loadNumbering } from '../numbering/repository.js';
import { businessToday } from '../time.js';
import type { StoredInvoice } from './repository.js';

/**
 * Full view of an invoice as the editor shows it: live totals for drafts (current company tax
 * mode) and the § 14 checklist (FR-INV-07). Shared by the REST API and the MCP tools.
 */
export async function invoiceDetail(db: Db, invoice: StoredInvoice) {
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

export type InvoiceDetailView = Awaited<ReturnType<typeof invoiceDetail>>;

/** A customer may be chosen for an invoice only if it exists and is not archived. */
export async function selectableCustomer(
  db: Db,
  id: number,
): Promise<{ error: string; message: string } | Customer> {
  const customer = await findCustomer(db, id);
  if (!customer) return { error: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' };
  if (customer.archived) {
    return { error: 'CUSTOMER_ARCHIVED', message: 'Archived customers cannot be selected' };
  }
  return customer;
}

/**
 * Content of a new draft (FR-INV-02, FR-COMP-03): invoice date = today, service date =
 * invoice date, payment term and texts from the company profile in the customer's language.
 */
export async function newDraftData(
  db: Db,
  customer: Customer | null,
): Promise<{ draft: InvoiceDraftData; taxMode: TaxMode }> {
  const { profile } = await loadCompany(db);
  const language: Language = customer?.invoiceLanguage ?? 'de';
  const today = businessToday();
  return {
    taxMode: profile.taxMode,
    draft: {
      customerId: customer?.id ?? null,
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
    },
  };
}
