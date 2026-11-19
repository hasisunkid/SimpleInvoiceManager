import type { Ref } from 'vue';
import { createI18n, useI18n } from 'vue-i18n';
import {
  FALLBACK_LANGUAGE,
  isLanguage,
  messages,
  negotiateLanguage,
  type Language,
  type Messages,
} from '@sim/i18n';
import { ApiError } from './api';

const STORAGE_KEY = 'sim.uiLanguage';

export function browserLanguage(): Language {
  return negotiateLanguage(navigator.languages ?? [navigator.language]);
}

/** FR-I18N-01 before login: last used language on this device → browser language → German. */
export function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage can be unavailable (private mode, HA Companion web view) – ignore.
  }
  return browserLanguage();
}

/** Switches the UI language and remembers it on this device. */
export function applyLanguage(locale: Ref<string>, language: Language): void {
  locale.value = language;
  document.documentElement.lang = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // ignore, see above
  }
}

/** After login: the user's saved preference wins (FR-AUTH-05), otherwise keep the current one. */
export function applyUserLanguage(locale: Ref<string>, preferred: Language | null): void {
  if (preferred) applyLanguage(locale, preferred);
}

export function createAppI18n(locale: Language = initialLanguage()) {
  return createI18n<[Messages], Language, false>({
    legacy: false,
    locale,
    fallbackLocale: FALLBACK_LANGUAGE,
    messages: messages as Record<Language, Messages>,
  });
}

/** Translates any error into a plain-language, actionable message (NFR-UX-03). */
export function useErrorText() {
  const { t, te } = useI18n();
  return (err: unknown): string => {
    const code = err instanceof ApiError ? err.code : 'UNKNOWN';
    const key = `errors.${code}`;
    if (!te(key)) return t('errors.UNKNOWN');
    const seconds = err instanceof ApiError ? (err.retryAfterSeconds ?? 60) : 60;
    return t(key, { seconds });
  };
}
