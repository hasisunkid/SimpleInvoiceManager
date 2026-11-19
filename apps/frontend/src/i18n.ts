import { createI18n } from 'vue-i18n';
import {
  FALLBACK_LANGUAGE,
  isLanguage,
  messages,
  negotiateLanguage,
  type Language,
  type Messages,
} from '@sim/i18n';

const STORAGE_KEY = 'sim.uiLanguage';

/** FR-I18N-01: saved choice → browser language → German. */
export function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage can be unavailable (private mode, HA Companion web view) – ignore.
  }
  return negotiateLanguage(navigator.languages ?? [navigator.language]);
}

export function rememberLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // ignore, see above
  }
  document.documentElement.lang = language;
}

export function createAppI18n(locale: Language = initialLanguage()) {
  return createI18n<[Messages], Language, false>({
    legacy: false,
    locale,
    fallbackLocale: FALLBACK_LANGUAGE,
    messages: messages as Record<Language, Messages>,
  });
}
