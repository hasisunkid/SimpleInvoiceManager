import type { CompanyProfile, LocalizedTexts, TaxMode, TextKind, VatRate } from '@sim/domain';
import type { Language } from '@sim/i18n';
import type { Db } from '../db.js';

interface CompanyRow {
  id: number;
  name: string;
  owner_name: string;
  street: string;
  zip: string;
  city: string;
  country_code: string;
  phone: string;
  mobile: string;
  email: string;
  website: string;
  tax_number: string;
  vat_id: string;
  bank_name: string;
  iban: string;
  bic: string;
  account_holder: string;
  tax_mode: TaxMode;
  default_payment_term_days: number;
  default_vat_rate: VatRate;
  signature_name: string;
  updated_at: Date;
}

interface TextRow {
  kind: TextKind;
  language: Language;
  text: string;
}

const EMPTY_TEXTS: LocalizedTexts = { de: '', pl: '', en: '' };

export interface StoredCompany {
  profile: CompanyProfile;
  updatedAt: Date;
}

export async function loadCompany(db: Db): Promise<StoredCompany> {
  const row = await db<CompanyRow>('company_profile').where({ id: 1 }).first();
  if (!row) throw new Error('company_profile row missing – migration 0003 not applied?');
  const texts = await db<TextRow>('company_text').select('kind', 'language', 'text');
  const byKind = (kind: TextKind): LocalizedTexts => ({
    ...EMPTY_TEXTS,
    ...Object.fromEntries(texts.filter((t) => t.kind === kind).map((t) => [t.language, t.text])),
  });
  return {
    profile: {
      name: row.name,
      ownerName: row.owner_name,
      street: row.street,
      zip: row.zip,
      city: row.city,
      countryCode: row.country_code,
      phone: row.phone,
      mobile: row.mobile,
      email: row.email,
      website: row.website,
      taxNumber: row.tax_number,
      vatId: row.vat_id,
      bankName: row.bank_name,
      iban: row.iban,
      bic: row.bic,
      accountHolder: row.account_holder,
      taxMode: row.tax_mode,
      defaultPaymentTermDays: row.default_payment_term_days,
      defaultVatRate: row.default_vat_rate,
      signatureName: row.signature_name,
      introTexts: byKind('INTRO'),
      closingTexts: byKind('CLOSING'),
    },
    updatedAt: row.updated_at,
  };
}

export async function saveCompany(db: Db, p: CompanyProfile, userId: number): Promise<void> {
  await db.transaction(async (trx) => {
    await trx('company_profile').where({ id: 1 }).update({
      name: p.name,
      owner_name: p.ownerName,
      street: p.street,
      zip: p.zip,
      city: p.city,
      country_code: p.countryCode,
      phone: p.phone,
      mobile: p.mobile,
      email: p.email,
      website: p.website,
      tax_number: p.taxNumber,
      vat_id: p.vatId,
      bank_name: p.bankName,
      iban: p.iban,
      bic: p.bic,
      account_holder: p.accountHolder,
      tax_mode: p.taxMode,
      default_payment_term_days: p.defaultPaymentTermDays,
      default_vat_rate: p.defaultVatRate,
      signature_name: p.signatureName,
      updated_by: userId,
      updated_at: new Date(),
    });
    const rows: TextRow[] = [];
    for (const [kind, texts] of [
      ['INTRO', p.introTexts],
      ['CLOSING', p.closingTexts],
    ] as const) {
      for (const [language, text] of Object.entries(texts)) {
        rows.push({ kind, language: language as Language, text });
      }
    }
    await trx('company_text').insert(rows).onConflict(['kind', 'language']).merge(['text']);
  });
}
