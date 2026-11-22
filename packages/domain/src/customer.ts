import type { DocumentLanguage } from './money.js';
import { isValidEmail, isValidVatId } from './bank.js';

/** FR-CUST-01: business customers (B2B) and private customers (B2C, § 35a note on PDF). */
export const CUSTOMER_TYPES = ['BUSINESS', 'PRIVATE'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export interface CustomerData {
  readonly type: CustomerType;
  /** Business customers: the company. Optional for private customers. */
  readonly companyName: string;
  /** Business: contact person ("Z. Hd."). Private: the customer's name. */
  readonly contactPerson: string;
  readonly street: string;
  readonly zip: string;
  readonly city: string;
  readonly countryCode: string;
  readonly email: string;
  readonly phone: string;
  readonly vatId: string;
  readonly invoiceLanguage: DocumentLanguage;
  readonly notes: string;
}

export type CustomerField = keyof CustomerData;
export type CustomerProblem =
  'NAME_REQUIRED' | 'INVALID_EMAIL' | 'INVALID_VAT_ID' | 'INVALID_COUNTRY';

/** The name shown in lists and printed first in the address. */
export function customerDisplayName(
  c: Pick<CustomerData, 'companyName' | 'contactPerson'>,
): string {
  return c.companyName.trim() || c.contactPerson.trim();
}

/**
 * Minimal checks so a quick-created customer (name + address, FR-CUST-05) is accepted; the
 * complete address is enforced when an invoice is finalized (§ 14 UStG, FR-INV-07).
 */
export function validateCustomer(c: CustomerData): Partial<Record<CustomerField, CustomerProblem>> {
  const problems: Partial<Record<CustomerField, CustomerProblem>> = {};
  if (c.type === 'BUSINESS' && !c.companyName.trim()) problems.companyName = 'NAME_REQUIRED';
  if (c.type === 'PRIVATE' && !c.contactPerson.trim()) problems.contactPerson = 'NAME_REQUIRED';
  if (c.email.trim() && !isValidEmail(c.email.trim())) {
    problems.email = 'INVALID_EMAIL';
  }
  if (c.vatId.trim() && !isValidVatId(c.vatId)) problems.vatId = 'INVALID_VAT_ID';
  if (!/^[A-Z]{2}$/.test(c.countryCode)) problems.countryCode = 'INVALID_COUNTRY';
  return problems;
}

/** Address fields required on a finalized invoice (§ 14 Abs. 4 Nr. 1 UStG). */
export type MissingCustomerField = 'name' | 'street' | 'zip' | 'city';

export function missingCustomerAddress(c: CustomerData): MissingCustomerField[] {
  const missing: MissingCustomerField[] = [];
  if (!customerDisplayName(c)) missing.push('name');
  if (!c.street.trim()) missing.push('street');
  if (!c.zip.trim()) missing.push('zip');
  if (!c.city.trim()) missing.push('city');
  return missing;
}

/**
 * Buyer data frozen into an invoice when it is finalized (FR-COMP-05). Later customer edits
 * never change finalized invoices.
 */
export interface BuyerSnapshot {
  readonly type: CustomerType;
  readonly name: string;
  /** Contact person for business customers ("Z. Hd."), empty for private customers. */
  readonly attention: string;
  readonly street: string;
  readonly zip: string;
  readonly city: string;
  readonly countryCode: string;
  readonly vatId: string;
}

export function buyerSnapshot(c: CustomerData): BuyerSnapshot {
  const isBusiness = c.type === 'BUSINESS';
  return {
    type: c.type,
    name: customerDisplayName(c),
    attention: isBusiness ? c.contactPerson.trim() : '',
    street: c.street.trim(),
    zip: c.zip.trim(),
    city: c.city.trim(),
    countryCode: c.countryCode,
    vatId: c.vatId.trim(),
  };
}
