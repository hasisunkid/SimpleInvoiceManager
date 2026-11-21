import { describe, expect, it } from 'vitest';
import {
  buyerSnapshot,
  customerDisplayName,
  isUnitCode,
  missingCustomerAddress,
  validateCatalogItem,
  validateCustomer,
  type CatalogItemData,
  type CustomerData,
} from '../src/index.js';

const business: CustomerData = {
  type: 'BUSINESS',
  companyName: 'Omicronservice GmbH',
  contactPerson: 'Herr Karaca',
  street: 'Industriestraße 5',
  zip: '54321',
  city: 'Beispielstadt',
  countryCode: 'DE',
  email: '',
  phone: '',
  vatId: 'DE123456789',
  invoiceLanguage: 'de',
  notes: '',
};

const privateCustomer: CustomerData = {
  ...business,
  type: 'PRIVATE',
  companyName: '',
  contactPerson: 'Anna Illing',
  vatId: '',
};

describe('customers (FR-CUST-01)', () => {
  it('uses the company name, otherwise the person', () => {
    expect(customerDisplayName(business)).toBe('Omicronservice GmbH');
    expect(customerDisplayName(privateCustomer)).toBe('Anna Illing');
  });

  it('accepts valid customers', () => {
    expect(validateCustomer(business)).toEqual({});
    expect(validateCustomer(privateCustomer)).toEqual({});
  });

  it('needs a company name for businesses and a name for private customers', () => {
    expect(validateCustomer({ ...business, companyName: ' ' })).toEqual({
      companyName: 'NAME_REQUIRED',
    });
    expect(validateCustomer({ ...privateCustomer, contactPerson: '' })).toEqual({
      contactPerson: 'NAME_REQUIRED',
    });
  });

  it('checks optional fields only when filled', () => {
    expect(
      validateCustomer({ ...business, email: 'x', vatId: 'DE1', countryCode: 'Deutschland' }),
    ).toEqual({ email: 'INVALID_EMAIL', vatId: 'INVALID_VAT_ID', countryCode: 'INVALID_COUNTRY' });
  });

  it('lists missing address parts for finalizing (§ 14 UStG)', () => {
    expect(missingCustomerAddress(business)).toEqual([]);
    expect(
      missingCustomerAddress({
        ...privateCustomer,
        contactPerson: '',
        street: '',
        zip: '',
        city: '',
      }),
    ).toEqual(['name', 'street', 'zip', 'city']);
  });

  it('snapshots the buyer with "Z. Hd." only for businesses', () => {
    expect(buyerSnapshot(business)).toMatchObject({
      name: 'Omicronservice GmbH',
      attention: 'Herr Karaca',
      vatId: 'DE123456789',
    });
    expect(buyerSnapshot({ ...privateCustomer, companyName: '' })).toMatchObject({
      name: 'Anna Illing',
      attention: '',
    });
  });
});

describe('catalog items (FR-CAT-01, FR-CAT-02)', () => {
  const item: CatalogItemData = {
    type: 'WORK',
    title: 'Stundenlohn Geselle',
    description: '',
    unitCode: 'HUR',
    unitPriceCents: 4500,
    vatRate: 19,
    active: true,
  };

  it('accepts valid items', () => {
    expect(validateCatalogItem(item)).toEqual({});
    expect(validateCatalogItem({ ...item, unitPriceCents: 0 })).toEqual({});
  });

  it('requires a title and a sane price', () => {
    expect(validateCatalogItem({ ...item, title: '', unitPriceCents: -1 })).toEqual({
      title: 'TITLE_REQUIRED',
      unitPriceCents: 'INVALID_PRICE',
    });
    expect(validateCatalogItem({ ...item, unitPriceCents: 1.5 })).toHaveProperty('unitPriceCents');
    expect(validateCatalogItem({ ...item, unitPriceCents: 1_000_000_001 })).toHaveProperty(
      'unitPriceCents',
    );
  });

  it('knows the UN/ECE unit codes', () => {
    expect(isUnitCode('HUR')).toBe(true);
    expect(isUnitCode('h')).toBe(false);
  });
});
