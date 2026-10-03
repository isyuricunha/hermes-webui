import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import ptBr from './pt-BR.json';

/**
 * YuTheme WebUI i18n. Resources are bundled (no async backend): the app is
 * local-first and must render offline. Language resolution: explicit user
 * choice (localStorage, set from Settings) > browser language > English.
 * Tests and e2e run with the default 'en' unless they opt in.
 */

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'hermes-webui.lang';

export function resolveLanguage(): LanguageCode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'pt-BR' || stored === 'en') return stored;
  const browser = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return browser.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

export function setLanguage(code: LanguageCode): void {
  localStorage.setItem(STORAGE_KEY, code);
  void i18n.changeLanguage(code);
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'pt-BR': { translation: ptBr },
  },
  lng: resolveLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
