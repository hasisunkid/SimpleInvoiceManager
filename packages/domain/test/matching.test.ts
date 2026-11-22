import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CATALOG_MATCH_THRESHOLD,
  CUSTOMER_MATCH_THRESHOLD,
  bigramSimilarity,
  catalogPositionText,
  catalogSimilarity,
  catalogWords,
  customerSimilarity,
  formatDecimalAmount,
  formatDecimalQuantity,
  normalizeCompanyName,
  normalizePersonName,
  normalizeText,
  parseDecimalAmount,
  parseDecimalQuantity,
  parseUnit,
  rankCandidates,
  type CatalogCandidate,
  type CustomerCandidate,
} from '../src/index.js';

const customer = (overrides: Partial<CustomerCandidate>): CustomerCandidate => ({
  id: 1,
  type: 'BUSINESS',
  companyName: '',
  contactPerson: '',
  zip: '',
  city: '',
  archived: false,
  ...overrides,
});

const omicron = customer({
  id: 12,
  companyName: 'Omicronservice GmbH',
  contactPerson: 'Herr Karaca',
  zip: '54321',
  city: 'Beispielstadt',
});
const goralewicz = customer({
  id: 7,
  type: 'PRIVATE',
  contactPerson: 'Anna Góralewicz',
  zip: '10115',
  city: 'Berlin',
});

describe('normalizeText / normalizeCompanyName (FR-MCP-05)', () => {
  it('ignores case, accents and Polish/German special letters', () => {
    expect(normalizeText('Góralewicz')).toBe('goralewicz');
    expect(normalizeText('Łódź – Straße 5!')).toBe('lodz strasse 5');
    expect(normalizeText('  ÄÖÜ  äöü ')).toBe('aou aou');
  });

  it('drops legal forms', () => {
    expect(normalizeCompanyName('Omicronservice GmbH')).toBe('omicronservice');
    expect(normalizeCompanyName('Kowalski Sp. z o.o.')).toBe('kowalski');
    expect(normalizeCompanyName('Müller Bau GmbH & Co. KG')).toBe('muller bau');
    expect(normalizeCompanyName('Hausbau UG (haftungsbeschränkt)')).toBe('hausbau');
  });
});

describe('customerSimilarity (FR-MCP-05, D8)', () => {
  const score = (name: string, extra: object = {}, c: CustomerCandidate = omicron) =>
    customerSimilarity({ name, ...extra }, c);

  it('matches another spelling, legal form or case', () => {
    expect(score('Omicronservice')).toBe(1);
    expect(score('omicronservice gmbh')).toBe(1);
    expect(score('Omicron Service')).toBeGreaterThanOrEqual(CUSTOMER_MATCH_THRESHOLD);
    expect(score('Omikronservice')).toBeGreaterThanOrEqual(CUSTOMER_MATCH_THRESHOLD);
  });

  it('matches accents and the person name of private customers', () => {
    expect(score('Anna Goralewicz', {}, goralewicz)).toBe(1);
    expect(score('goralewicz anna', {}, goralewicz)).toBe(1);
    expect(score('Góralewicz', {}, goralewicz)).toBeGreaterThanOrEqual(CUSTOMER_MATCH_THRESHOLD);
  });

  it('keeps long names that share most words apart', () => {
    const e2e = customer({ type: 'PRIVATE', contactPerson: 'E2E Kunde mobile mi9x2kab' });
    expect(score('KI Kunde mobile mi9x2kcd', {}, e2e)).toBeLessThan(CUSTOMER_MATCH_THRESHOLD);
    expect(score('Möller Bau', {}, customer({ companyName: 'Müller Bau GmbH' }))).toBeLessThan(
      CUSTOMER_MATCH_THRESHOLD,
    );
    // Short generic words alone are not enough.
    expect(score('Bau', {}, customer({ companyName: 'Müller Bau GmbH' }))).toBeLessThan(
      CUSTOMER_MATCH_THRESHOLD,
    );
  });

  it('does not match unrelated names', () => {
    expect(score('Illing')).toBeLessThan(CUSTOMER_MATCH_THRESHOLD);
    expect(score('Omega Bau')).toBeLessThan(CUSTOMER_MATCH_THRESHOLD);
    expect(score('Anna Nowak', {}, goralewicz)).toBeLessThan(CUSTOMER_MATCH_THRESHOLD);
    expect(score('')).toBe(0);
  });

  it('uses ZIP or city to confirm or reject a name match', () => {
    expect(score('Omicronservice', { zip: '54321' })).toBe(1);
    expect(score('Omicron Service GmbH', { zip: '54321' })).toBeGreaterThanOrEqual(
      score('Omicron Service GmbH'),
    );
    // Same name somewhere else is another customer.
    expect(score('Omicronservice', { zip: '99999' })).toBeLessThan(CUSTOMER_MATCH_THRESHOLD);
    expect(score('Omicronservice', { city: 'Hamburg' })).toBeLessThan(CUSTOMER_MATCH_THRESHOLD);
    expect(score('Omicronservice', { city: 'beispielstadt' })).toBe(1);
  });

  it('finds a business by its contact person (salutation ignored)', () => {
    expect(normalizePersonName('Frau Dr. Anna Nowak')).toBe('anna nowak');
    expect(score('Karaca', { contactPerson: 'Karaca' })).toBeGreaterThanOrEqual(
      CUSTOMER_MATCH_THRESHOLD,
    );
  });

  it('is always between 0 and 1', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (name, company, zip) => {
        const s = customerSimilarity({ name, zip }, customer({ companyName: company, zip: '1' }));
        return s >= 0 && s <= 1;
      }),
    );
  });
});

describe('rankCandidates', () => {
  it('keeps candidates above the threshold, best (then oldest) first', () => {
    const items = [
      { id: 3, s: 0.9 },
      { id: 1, s: 0.9 },
      { id: 2, s: 0.95 },
      { id: 4, s: 0.2 },
    ];
    expect(rankCandidates(items, (i) => i.s, 0.8).map((r) => r.candidate.id)).toEqual([2, 1, 3]);
  });
});

describe('catalogSimilarity (FR-MCP-08, D8)', () => {
  const entry = (overrides: Partial<CatalogCandidate>): CatalogCandidate => ({
    id: 1,
    type: 'WORK',
    title: '',
    description: '',
    unitCode: 'HUR',
    ...overrides,
  });
  const material = entry({ id: 2, type: 'MATERIAL', title: 'Material', unitCode: 'LS' });
  const plaster = entry({ id: 3, title: 'Putzarbeiten', description: 'Innenputz, Kalkzement' });

  it('reuses an entry with the same meaning', () => {
    expect(catalogSimilarity({ type: 'MATERIAL', title: 'Material pauschal' }, material)).toBe(1);
    expect(
      catalogSimilarity({ type: 'WORK', title: 'Putzarbeit Stunde', unitCode: 'HUR' }, plaster),
    ).toBeGreaterThanOrEqual(CATALOG_MATCH_THRESHOLD);
    expect(
      catalogSimilarity({ type: 'WORK', title: 'putzarbeiten innen' }, plaster),
    ).toBeGreaterThanOrEqual(CATALOG_MATCH_THRESHOLD);
  });

  it('requires the same type and a compatible unit', () => {
    expect(catalogSimilarity({ type: 'WORK', title: 'Material' }, material)).toBe(0);
    expect(
      catalogSimilarity({ type: 'WORK', title: 'Putzarbeiten', unitCode: 'MTK' }, plaster),
    ).toBe(0);
  });

  it('does not match unrelated work', () => {
    expect(catalogSimilarity({ type: 'WORK', title: 'Trockenbau' }, plaster)).toBeLessThan(
      CATALOG_MATCH_THRESHOLD,
    );
    expect(catalogSimilarity({ type: 'WORK', title: 'Stunde' }, plaster)).toBe(0);
  });

  it('ignores units, numbers and filler words', () => {
    expect(catalogWords('3 Std. Putzarbeiten und Spachteln pauschal')).toEqual([
      'putzarbeiten',
      'spachteln',
    ]);
  });

  it('writes title and description like the editor (FR-CAT-03)', () => {
    expect(catalogPositionText({ title: 'Putz', description: 'Innen' })).toBe('Putz\nInnen');
    expect(catalogPositionText({ title: 'Putz', description: ' ' })).toBe('Putz');
  });

  it('bigram similarity is symmetric and 1 for equal strings', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const ab = bigramSimilarity(a, b);
        return Math.abs(ab - bigramSimilarity(b, a)) < 1e-12 && ab >= 0 && ab <= 1;
      }),
    );
    expect(bigramSimilarity('abc', 'abc')).toBe(1);
    expect(bigramSimilarity('', '')).toBe(0);
    expect(bigramSimilarity('a', 'b')).toBe(0);
  });
});

describe('decimal strings (FR-MCP-09)', () => {
  it('parses amounts without floating point', () => {
    expect(parseDecimalAmount('1755.00')).toBe(175500);
    expect(parseDecimalAmount('48')).toBe(4800);
    expect(parseDecimalAmount('0.5')).toBe(50);
    expect(parseDecimalAmount(' 640 ')).toBe(64000);
    for (const bad of ['1,755.00', '1.755,00', '-5', '1.234', '1e3', '', 'abc', '0.001']) {
      expect(parseDecimalAmount(bad)).toBeNull();
    }
  });

  it('parses quantities with up to three decimals', () => {
    expect(parseDecimalQuantity('2.5')).toBe(2500);
    expect(parseDecimalQuantity('0.125')).toBe(125);
    expect(parseDecimalQuantity('3')).toBe(3000);
    for (const bad of ['2,5', '1.2345', '-1', '']) expect(parseDecimalQuantity(bad)).toBeNull();
  });

  it('formats back to decimal strings', () => {
    expect(formatDecimalAmount(175500)).toBe('1755.00');
    expect(formatDecimalAmount(-5)).toBe('-0.05');
    expect(formatDecimalQuantity(2500)).toBe('2.5');
    expect(formatDecimalQuantity(3000)).toBe('3');
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999 }), (c) => {
        return parseDecimalAmount(formatDecimalAmount(c)) === c;
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999_999_999 }), (m) => {
        return parseDecimalQuantity(formatDecimalQuantity(m)) === m;
      }),
    );
  });
});

describe('parseUnit (FR-MCP-09, FR-CAT-02)', () => {
  it('maps common names and codes', () => {
    expect(parseUnit('Std.')).toBe('HUR');
    expect(parseUnit('h')).toBe('HUR');
    expect(parseUnit('HUR')).toBe('HUR');
    expect(parseUnit('Stück')).toBe('H87');
    expect(parseUnit('m²')).toBe('MTK');
    expect(parseUnit('m3')).toBe('MTQ');
    expect(parseUnit('pauschal')).toBe('LS');
    expect(parseUnit('lump sum')).toBe('LS');
    expect(parseUnit('ryczałt')).toBe('LS');
    expect(parseUnit('kg')).toBe('KGM');
    expect(parseUnit('m')).toBe('MTR');
    expect(parseUnit('barrel')).toBeNull();
  });
});
