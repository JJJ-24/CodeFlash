import { Platform, type TextStyle } from 'react-native';

import type { SupportedLanguage } from '@/lib/i18n';

/**
 * 言語名（自言語表記）を描くフォント。**中国語の2つだけ明示する**。
 * iOS の標準フォントには漢字が無く、代わりのフォントは**アプリの表示言語**で選ばれる＝日本語 UI では
 * 「繁體中文」（日本語にもある字だけ）はヒラギノ、「简体中文」の「简」（簡体字だけの字）は PingFang SC で
 * 描かれ、同じ fontSize でも字の大きさが違って見えた。PingFang の SC/TC を明示すれば2行とも同じ仲間の
 * フォントでそろい、字形もそれぞれの地域のものになる。PingFang は iOS にしか無いので他は指定しない。
 */
const FONTS: Partial<Record<SupportedLanguage, string>> = {
  'zh-Hans': 'PingFang SC',
  'zh-Hant': 'PingFang TC',
};

export function languageNameFont(code: SupportedLanguage): TextStyle | undefined {
  const fontFamily = Platform.OS === 'ios' ? FONTS[code] : undefined;
  return fontFamily ? { fontFamily } : undefined;
}
