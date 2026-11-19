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
