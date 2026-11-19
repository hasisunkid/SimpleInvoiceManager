import type { DocumentLanguage } from './money.js';
import { formatIban, isValidBic, isValidIban, isValidTaxNumber, isValidVatId } from './bank.js';

/** FR-COMP-02: VAT is charged (REGULAR) or the business is a Kleinunternehmer (§ 19 UStG). */
export const TAX_MODES = ['REGULAR', 'SMALL_BUSINESS_19'] as const;
export type TaxMode = (typeof TAX_MODES)[number];

/** FR-INV-03: VAT rates allowed in v1 (percent). */
export const VAT_RATES = [19, 7, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];

export const TEXT_KINDS = ['INTRO', 'CLOSING'] as const;
export type TextKind = (typeof TEXT_KINDS)[number];

/** Default texts per document language (FR-COMP-03). */
export type LocalizedTexts = Readonly<Record<DocumentLanguage, string>>;

/** The single company profile (FR-COMP-01..03). Empty string = not filled in. */
export interface CompanyProfile {
  readonly name: string;
  readonly ownerName: string;
  readonly street: string;
  readonly zip: string;
  readonly city: string;
  /** ISO 3166-1 alpha-2 (needed for e-invoicing, §8). */
  readonly countryCode: string;
  readonly phone: string;
  readonly mobile: string;
  readonly email: string;
  readonly website: string;
  readonly taxNumber: string;
  readonly vatId: string;
  readonly bankName: string;
  readonly iban: string;
  readonly bic: string;
  readonly accountHolder: string;
  readonly taxMode: TaxMode;
  readonly defaultPaymentTermDays: number;
  readonly defaultVatRate: VatRate;
  readonly signatureName: string;
  readonly introTexts: LocalizedTexts;
  readonly closingTexts: LocalizedTexts;
}

export type CompanyField = Exclude<keyof CompanyProfile, 'introTexts' | 'closingTexts'>;

export type CompanyProblem =
  | 'INVALID_IBAN'
  | 'INVALID_BIC'
  | 'INVALID_VAT_ID'
  | 'INVALID_TAX_NUMBER'
  | 'INVALID_EMAIL'
  | 'INVALID_COUNTRY'
  | 'INVALID_PAYMENT_TERM';

/**
 * Format problems of filled-in fields (FR-COMP-04). Empty optional fields are fine here;
 * completeness for finalizing is checked by `missingForFinalize`.
 */
export function validateCompany(
  profile: CompanyProfile,
): Partial<Record<CompanyField, CompanyProblem>> {
  const problems: Partial<Record<CompanyField, CompanyProblem>> = {};
  if (profile.iban && !isValidIban(profile.iban)) problems.iban = 'INVALID_IBAN';
  if (profile.bic && !isValidBic(profile.bic)) problems.bic = 'INVALID_BIC';
  if (profile.vatId && !isValidVatId(profile.vatId)) problems.vatId = 'INVALID_VAT_ID';
  if (profile.taxNumber && !isValidTaxNumber(profile.taxNumber)) {
    problems.taxNumber = 'INVALID_TAX_NUMBER';
  }
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
    problems.email = 'INVALID_EMAIL';
  }
  if (!/^[A-Z]{2}$/.test(profile.countryCode)) problems.countryCode = 'INVALID_COUNTRY';
  if (
    !Number.isInteger(profile.defaultPaymentTermDays) ||
    profile.defaultPaymentTermDays < 0 ||
    profile.defaultPaymentTermDays > 365
  ) {
    problems.defaultPaymentTermDays = 'INVALID_PAYMENT_TERM';
  }
  return problems;
}

/** Fields that must be filled before any invoice can be finalized (§ 14 Abs. 4 UStG, FR-COMP-04). */
export type MissingCompanyField = 'name' | 'street' | 'zip' | 'city' | 'countryCode' | 'taxId';

export function missingForFinalize(profile: CompanyProfile): MissingCompanyField[] {
  const missing: MissingCompanyField[] = [];
  if (!profile.name.trim()) missing.push('name');
  if (!profile.street.trim()) missing.push('street');
  if (!profile.zip.trim()) missing.push('zip');
  if (!profile.city.trim()) missing.push('city');
  if (!profile.countryCode.trim()) missing.push('countryCode');
  if (!profile.taxNumber.trim() && !profile.vatId.trim()) missing.push('taxId');
  return missing;
}

/**
 * Seller data frozen into an invoice when it is finalized (FR-COMP-05). Holds everything the
 * PDF and a later ZUGFeRD export need (§8), so profile changes never touch old invoices.
 */
export interface SellerSnapshot {
  readonly name: string;
  readonly ownerName: string;
  readonly street: string;
  readonly zip: string;
  readonly city: string;
  readonly countryCode: string;
  readonly phone: string;
  readonly mobile: string;
  readonly email: string;
  readonly website: string;
  readonly taxNumber: string;
  readonly vatId: string;
  readonly bankName: string;
  readonly iban: string;
  readonly bic: string;
  readonly accountHolder: string;
  readonly taxMode: TaxMode;
  readonly signatureName: string;
}

export function sellerSnapshot(profile: CompanyProfile): SellerSnapshot {
  return {
    name: profile.name.trim(),
    ownerName: profile.ownerName.trim(),
    street: profile.street.trim(),
    zip: profile.zip.trim(),
    city: profile.city.trim(),
    countryCode: profile.countryCode,
    phone: profile.phone.trim(),
    mobile: profile.mobile.trim(),
    email: profile.email.trim(),
    website: profile.website.trim(),
    taxNumber: profile.taxNumber.trim(),
    vatId: profile.vatId.trim(),
    bankName: profile.bankName.trim(),
    iban: profile.iban ? formatIban(profile.iban) : '',
    bic: profile.bic.trim().toUpperCase(),
    accountHolder: (profile.accountHolder || profile.ownerName).trim(),
    taxMode: profile.taxMode,
    signatureName: (profile.signatureName || profile.ownerName).trim(),
  };
}
