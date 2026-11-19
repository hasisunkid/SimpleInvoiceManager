import { describe, expect, it } from 'vitest';
import {
  missingForFinalize,
  sellerSnapshot,
  validateCompany,
  type CompanyProfile,
} from '../src/index.js';

const texts = { de: '', pl: '', en: '' };

export const profile: CompanyProfile = {
  name: 'Bau & Renovierung Góralewicz',
  ownerName: 'Jan Góralewicz',
  street: 'Hauptstraße 1',
  zip: '12345',
  city: 'Musterstadt',
  countryCode: 'DE',
  phone: '',
  mobile: '0170 1234567',
  email: 'info@example.com',
  website: '',
  taxNumber: '12/345/67890',
  vatId: '',
  bankName: 'Sparkasse',
  iban: 'DE89370400440532013000',
  bic: 'COBADEFFXXX',
  accountHolder: '',
  taxMode: 'REGULAR',
  defaultPaymentTermDays: 30,
  defaultVatRate: 19,
  signatureName: '',
  introTexts: texts,
  closingTexts: texts,
};

describe('validateCompany (FR-COMP-04)', () => {
  it('accepts a valid profile', () => {
    expect(validateCompany(profile)).toEqual({});
  });

  it('accepts empty optional fields', () => {
    expect(validateCompany({ ...profile, iban: '', bic: '', email: '', taxNumber: '' })).toEqual(
      {},
    );
  });

  it('reports every malformed field', () => {
    expect(
      validateCompany({
        ...profile,
        iban: 'DE00 1234',
        bic: 'XX',
        vatId: 'DE1',
        taxNumber: 'abc',
        email: 'not-an-email',
        countryCode: 'Germany',
        defaultPaymentTermDays: 400,
      }),
    ).toEqual({
      iban: 'INVALID_IBAN',
      bic: 'INVALID_BIC',
      vatId: 'INVALID_VAT_ID',
      taxNumber: 'INVALID_TAX_NUMBER',
      email: 'INVALID_EMAIL',
      countryCode: 'INVALID_COUNTRY',
      defaultPaymentTermDays: 'INVALID_PAYMENT_TERM',
    });
    expect(validateCompany({ ...profile, defaultPaymentTermDays: 1.5 })).toHaveProperty(
      'defaultPaymentTermDays',
    );
  });
});

describe('missingForFinalize (FR-COMP-04, § 14 UStG)', () => {
  it('is empty for a complete profile', () => {
    expect(missingForFinalize(profile)).toEqual([]);
  });

  it('accepts a VAT ID instead of a Steuernummer', () => {
    expect(missingForFinalize({ ...profile, taxNumber: '', vatId: 'DE123456789' })).toEqual([]);
  });

  it('lists everything missing', () => {
    const empty = {
      ...profile,
      name: ' ',
      street: '',
      zip: '',
      city: '',
      countryCode: '',
      taxNumber: '',
      vatId: '',
    };
    expect(missingForFinalize(empty)).toEqual([
      'name',
      'street',
      'zip',
      'city',
      'countryCode',
      'taxId',
    ]);
  });
});

describe('sellerSnapshot (FR-COMP-05)', () => {
  it('copies the profile, formats the IBAN and falls back to the owner name', () => {
    const snapshot = sellerSnapshot({ ...profile, name: '  Firma  ', bic: 'cobadeffxxx' });
    expect(snapshot).toMatchObject({
      name: 'Firma',
      iban: 'DE89 3704 0044 0532 0130 00',
      bic: 'COBADEFFXXX',
      accountHolder: 'Jan Góralewicz',
      signatureName: 'Jan Góralewicz',
      taxMode: 'REGULAR',
    });
    expect(snapshot).not.toHaveProperty('introTexts');
  });

  it('keeps explicit account holder and signature', () => {
    const snapshot = sellerSnapshot({
      ...profile,
      iban: '',
      accountHolder: 'Ewa G.',
      signatureName: 'Ewa',
    });
    expect(snapshot).toMatchObject({ iban: '', accountHolder: 'Ewa G.', signatureName: 'Ewa' });
  });
});
