import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@/locales/en.json';
import ja from '@/locales/ja.json';

const deviceLang = getLocales()[0]?.languageCode ?? 'ja';

i18n.use(initReactI18next).init({
  resources: {
    ja: { translation: ja },
    en: { translation: en },
  },
  lng: ['ja', 'en'].includes(deviceLang) ? deviceLang : 'en',
  fallbackLng: 'en',
  initImmediate: false,
  interpolation: { escapeValue: false },
});

export default i18n;
