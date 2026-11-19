import { describe, expect, it } from 'vitest';
import { LANGUAGES, flattenKeys, messages, negotiateLanguage } from '../src/index.js';

describe('translations (FR-I18N-04, TR-05)', () => {
  const reference = flattenKeys(messages.de).sort();

  it.each(LANGUAGES)('%s has exactly the same keys as German', (lang) => {
    expect(flattenKeys(messages[lang]).sort()).toEqual(reference);
  });

  it.each(LANGUAGES)('%s has no empty texts', (lang) => {
    const walk = (obj: object): string[] =>
      Object.values(obj).flatMap((v) => (typeof v === 'string' ? [v] : walk(v as object)));
    expect(walk(messages[lang]).filter((t) => t.trim() === '')).toEqual([]);
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
