import { describe, expect, it } from 'vitest';
import {
  dueDate,
  finalizeProblems,
  isOverdue,
  positionProblems,
  type CompanyProfile,
  type CustomerData,
  type InvoiceDraftData,
} from '../src/index.js';

const texts = { de: '', pl: '', en: '' };
const company: CompanyProfile = {
  name: 'Bau Góralewicz',
  ownerName: 'Jan Góralewicz',
  street: 'Hauptstraße 1',
  zip: '12345',
  city: 'Musterstadt',
  countryCode: 'DE',
  phone: '',
  mobile: '',
  email: '',
  website: '',
  taxNumber: '12/345/67890',
  vatId: '',
  bankName: '',
  iban: '',
  bic: '',
  accountHolder: '',
  taxMode: 'REGULAR',
  defaultPaymentTermDays: 30,
  defaultVatRate: 19,
  signatureName: '',
  introTexts: texts,
  closingTexts: texts,
};
const customer: CustomerData & { archived: boolean } = {
  type: 'PRIVATE',
  companyName: '',
  contactPerson: 'Anna Illing',
  street: 'Gartenweg 7',
  zip: '12345',
  city: 'Musterstadt',
  countryCode: 'DE',
  email: '',
  phone: '',
  vatId: '',
  invoiceLanguage: 'de',
  notes: '',
  archived: false,
};
const draft: InvoiceDraftData = {
  customerId: 1,
  documentLanguage: 'de',
  invoiceDate: '2024-03-05',
  serviceDateFrom: '2024-02-28',
  serviceDateTo: null,
  paymentTermDays: 30,
  siteAddress: '',
  subject: '',
  introText: '',
  closingText: '',
  positions: [
    {
      type: 'WORK',
      description: 'Entsorgung von Gartenabfällen',
      quantityMilli: 1000,
      unitCode: 'LS',
      unitPriceCents: 8000,
      vatRate: 19,
    },
  ],
};

describe('finalizeProblems (FR-INV-07, § 14 UStG)', () => {
  it('accepts a complete invoice', () => {
    expect(finalizeProblems(draft, customer, company)).toEqual([]);
  });

  it('reports every missing mandatory part', () => {
    expect(
      finalizeProblems({ ...draft, positions: [] }, null, { ...company, taxNumber: '' }),
    ).toEqual(['COMPANY_INCOMPLETE', 'CUSTOMER_MISSING', 'NO_POSITIONS']);
    expect(
      finalizeProblems(
        { ...draft, positions: [{ ...draft.positions[0]!, description: ' ' }] },
        { ...customer, street: '', archived: true },
        company,
      ),
    ).toEqual(['CUSTOMER_ADDRESS_INCOMPLETE', 'CUSTOMER_ARCHIVED', 'POSITION_DESCRIPTION_MISSING']);
  });

  it('checks dates and the service period', () => {
    expect(finalizeProblems({ ...draft, serviceDateTo: '2024-02-01' }, customer, company)).toEqual([
      'SERVICE_PERIOD_INVALID',
    ]);
    expect(finalizeProblems({ ...draft, invoiceDate: '05.03.2024' }, customer, company)).toEqual([
      'INVALID_DATE',
    ]);
    expect(finalizeProblems({ ...draft, serviceDateTo: 'x' }, customer, company)).toEqual([
      'INVALID_DATE',
    ]);
    expect(finalizeProblems({ ...draft, serviceDateTo: '2024-03-01' }, customer, company)).toEqual(
      [],
    );
  });
});

describe('positions and dates', () => {
  it('validates quantity and price', () => {
    const p = draft.positions[0]!;
    expect(positionProblems(p)).toEqual([]);
    expect(positionProblems({ ...p, quantityMilli: 0, unitPriceCents: -1 })).toEqual([
      'INVALID_QUANTITY',
      'INVALID_PRICE',
    ]);
    expect(positionProblems({ ...p, quantityMilli: 1.5 })).toEqual(['INVALID_QUANTITY']);
  });

  it('computes due dates and overdue flags (FR-INV-10)', () => {
    expect(dueDate('2024-05-22', 30)).toBe('2024-06-21');
    expect(isOverdue('OPEN', '2024-06-21', '2024-06-22')).toBe(true);
    expect(isOverdue('OPEN', '2024-06-21', '2024-06-21')).toBe(false);
    expect(isOverdue('PAID', '2024-06-21', '2025-01-01')).toBe(false);
  });
});
