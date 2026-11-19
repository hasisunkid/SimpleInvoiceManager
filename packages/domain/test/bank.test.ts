import { describe, expect, it } from 'vitest';
import {
  formatIban,
  isValidBic,
  isValidIban,
  isValidTaxNumber,
  isValidVatId,
  normalizeIban,
} from '../src/index.js';

describe('IBAN (FR-COMP-04)', () => {
  it.each([
    'DE89370400440532013000',
    'de89 3704 0044 0532 0130 00',
    'AT611904300234573201',
    'PL61109010140000071219812874',
    'GB82WEST12345698765432',
    'NO9386011117947', // country without length entry
  ])('accepts %s', (iban) => {
    expect(isValidIban(iban)).toBe(true);
  });

  it.each([
    'DE89370400440532013001', // wrong checksum
    'DE8937040044053201300', // wrong length for DE
    'XX', // too short
    'DE89-3704-0044-0532-0130-00', // invalid characters
    '',
  ])('rejects %s', (iban) => {
    expect(isValidIban(iban)).toBe(false);
  });

  it('normalizes and formats in groups of four', () => {
    expect(normalizeIban(' de89 3704 0044 0532 0130 00 ')).toBe('DE89370400440532013000');
    expect(formatIban('DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00');
  });
});

describe('BIC', () => {
  it.each(['COBADEFFXXX', 'COBADEFF', 'cobadeff', 'BELADEBEXXX'])('accepts %s', (bic) => {
    expect(isValidBic(bic)).toBe(true);
  });

  it.each(['COBADEF', 'COBA1EFF', 'COBADEFFXX', ''])('rejects %s', (bic) => {
    expect(isValidBic(bic)).toBe(false);
  });
});

describe('VAT ID', () => {
  it.each(['DE123456789', 'de 123 456 789', 'PL1234567890', 'ATU12345678'])('accepts %s', (id) => {
    expect(isValidVatId(id)).toBe(true);
  });

  it.each(['DE12345678', 'DE1234567890', '123456789', 'D'])('rejects %s', (id) => {
    expect(isValidVatId(id)).toBe(false);
  });
});

describe('Steuernummer', () => {
  it.each(['12/345/67890', '123/456/78901', '1234567890123', '21 815 08150'])(
    'accepts %s',
    (no) => {
      expect(isValidTaxNumber(no)).toBe(true);
    },
  );

  it.each(['123/456', 'AB/345/67890', '12345678901234'])('rejects %s', (no) => {
    expect(isValidTaxNumber(no)).toBe(false);
  });
});
