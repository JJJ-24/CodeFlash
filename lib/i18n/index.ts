import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@/locales/en.json';
import es from '@/locales/es.json';
import ja from '@/locales/ja.json';

/**
 * 対応言語（047）＝**コード → その言語での言語名（自言語表記）**。
 * 言語を足すときは `locales/xx.json` を作り、上の import とここへ 1 行ずつ足すだけでよい。
 *
 * ⚠️ **端末言語の判定・設定の選択肢・言語名の表示は、すべてここが唯一の定義元**
 * （`store/settings.ts` の `resolveLanguage`／`LanguagePreference`、`LanguagePickerModal` が派生）
 * ＝ 2言語前提の `['ja','en'].includes(...)` を別の場所に書き足さないこと。
 * ⚠️ **言語名を翻訳ファイルに置かない**＝自言語表記はどの UI 言語でも同じ文字列なので、
 * `locales/*.json` に置くと言語数 × 対応言語数ぶん同じ値が並ぶ（実際そうなっていたので剥がした）。
 * `Intl.DisplayNames` は iOS の Hermes に無いため OS からも取れず、表を持つしかない。
 */
export const SUPPORTED_LANGUAGES = {
  ja: '日本語',
  en: 'English',
  es: 'Español',
} as const;
export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;
export const SUPPORTED_LANGUAGE_CODES = Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[];

export function isSupportedLanguage(code: string | undefined | null): code is SupportedLanguage {
  return !!code && code in SUPPORTED_LANGUAGES;
}

/**
 * 端末言語を対応言語へ解決した結果＝**「システム」を選んだときに実際に使われる言語**。
 * ⚠️ 起動時の `lng` と `store/settings.ts` の `resolveLanguage` の**両方がこれを呼ぶ**
 * （かつて同じ2行が2箇所に複製されていた）。
 */
export function resolveSystemLanguage(): SupportedLanguage {
  const code = getLocales()[0]?.languageCode ?? 'ja';
  return isSupportedLanguage(code) ? code : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    ja: { translation: ja },
    en: { translation: en },
    es: { translation: es },
  },
  lng: resolveSystemLanguage(),
  fallbackLng: 'en',
  initImmediate: false,
  interpolation: { escapeValue: false },
});

export default i18n;
