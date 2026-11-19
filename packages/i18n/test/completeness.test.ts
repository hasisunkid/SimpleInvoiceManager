import { describe, expect, it } from 'vitest';
import { LANGUAGES, flattenKeys, messages, negotiateLanguage } from '../src/index.js';

function texts(obj: object): string[] {
  return Object.values(obj).flatMap((v) => (typeof v === 'string' ? [v] : texts(v as object)));
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

function lookup(obj: object, key: string): string {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj) as string;
}

describe('translations (FR-I18N-04, TR-05)', () => {
  const reference = flattenKeys(messages.de).sort();

  it.each(LANGUAGES)('%s has exactly the same keys as German', (lang) => {
    expect(flattenKeys(messages[lang]).sort()).toEqual(reference);
  });

  it.each(LANGUAGES)('%s has no empty texts', (lang) => {
    expect(texts(messages[lang]).filter((t) => t.trim() === '')).toEqual([]);
  });

  it.each(LANGUAGES)('%s uses the same placeholders as German', (lang) => {
    for (const key of reference) {
      expect(placeholders(lookup(messages[lang], key)), key).toEqual(
        placeholders(lookup(messages.de, key)),
      );
    }
  });

  it.each(LANGUAGES)('%s contains no vue-i18n special characters by accident', (lang) => {
    // "@" starts linked messages and "|" separates plurals in vue-i18n.
    expect(texts(messages[lang]).filter((t) => /[@|]/.test(t))).toEqual([]);
  });
});

describe('negotiateLanguage (FR-I18N-01)', () => {
  it('uses the first supported browser language', () => {
    expect(negotiateLanguage(['fr-FR', 'pl-PL', 'de'])).toBe('pl');
    expect(negotiateLanguage(['en_US'])).toBe('en');
  });

  it('falls back to German', () => {
    expect(negotiateLanguage(['fr', 'it'])).toBe('de');
    expect(negotiateLanguage([])).toBe('de');
  });
});

describe('translate (server-side, FR-I18N-02)', () => {
  it('looks up nested keys and fills placeholders', async () => {
    const { translate } = await import('../src/index.js');
    expect(translate('de', 'pdf.invoice')).toBe('Rechnung');
    expect(translate('pl', 'pdf.page', { page: 1, pages: 2 })).toBe('Strona 1 z 2');
    expect(translate('en', 'pdf.vatRate', { rate: 19 })).toBe('VAT 19 %');
    expect(translate('de', 'pdf.days')).toBe('{days} Tage');
  });

  it('throws for keys that are not texts', async () => {
    const { translate } = await import('../src/index.js');
    // @ts-expect-error – "pdf" is a group, not a text
    expect(() => translate('de', 'pdf')).toThrow(/Missing translation/);
  });
});
