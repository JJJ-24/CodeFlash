export const PRIVACY_URL = 'https://jjj-24.github.io/CodeFlash/privacy';
export const TERMS_URL = 'https://jjj-24.github.io/CodeFlash/terms';

/**
 * プライバシーポリシー・利用規約のページに節がある言語（`privacy.md`/`terms.md` の
 * `## 日本語 {#ja}` のような見出しの目印）。
 * ⚠️ アプリの対応言語（`SUPPORTED_LANGUAGES`）とは別に持つ＝規約は本格的に売る言語だけ訳し、
 *    画面だけ訳した言語は英語の節を出す方針のため。ページに節を足したらここにも足す。
 */
const POLICY_LANGUAGES = ['ja', 'en', 'es'] as const;

/** 表示言語の節へ直接飛ぶ URL（節が無い言語は英語の節）。 */
export function policyUrl(base: string, language: string): string {
  const lang = (POLICY_LANGUAGES as readonly string[]).includes(language) ? language : 'en';
  return `${base}#${lang}`;
}
export const CONTACT_EMAIL = 'jjj24.support@gmail.com';
export const APP_STORE_ID = '6761161171';
export const APP_STORE_REVIEW_URL = `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`;
