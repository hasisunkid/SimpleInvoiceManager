import { de } from './de.js';
import { en } from './en.js';
import { pl } from './pl.js';
import type { Messages } from './types.js';

export type { Messages } from './types.js';

export const LANGUAGES = ['de', 'pl', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const FALLBACK_LANGUAGE: Language = 'de';

export const messages: Readonly<Record<Language, Messages>> = { de, pl, en };

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Picks the UI language from a list of browser preferences (FR-I18N-01):
 * first supported primary subtag wins, otherwise German.
 */
export function negotiateLanguage(preferences: readonly string[]): Language {
  for (const pref of preferences) {
    const primary = pref.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(primary)) return primary;
  }
  return FALLBACK_LANGUAGE;
}

/** Flattens nested messages into dotted keys – used by the completeness test (TR-05). */
export function flattenKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? flattenKeys(value as object, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}
