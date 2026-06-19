// 028-2: 学習画面のカードテーマプリセット。
// Pro 機能として 6 プリセット × ライト/ダーク × 4 色（背景・メモ背景・枠線・コード背景）を提供。
//
// memoBackground は background と同系の少し違う色。
//   ライト: background より 5〜8% 暗い同系色
//   ダーク: background より 10〜15% 明るい同系色
// これは現状の `theme.colors.surface` と `theme.colors.memoBackground` の関係を踏襲する。

export type CardThemeName = 'default' | 'paper' | 'mint' | 'graphite' | 'lavender' | 'sepia' | 'sky' | 'rose';

export interface CardThemePalette {
  /** 表面・裏面のカード本体背景 */
  background: string;
  /** メモ背景（background と同系の少し異なる色） */
  memoBackground: string;
  /** カード本体の枠線色 */
  border: string;
  /** カード内コードブロックの背景 */
  codeBackground: string;
}

export const CARD_THEME_NAMES: readonly CardThemeName[] = [
  'default', 'paper', 'sky', 'rose', 'mint', 'lavender', 'graphite', 'sepia',
] as const;

/** 無料版でも選べる配色（味見用）。これ以外は Pro 限定。 */
export const FREE_CARD_THEMES: readonly CardThemeName[] = ['default', 'paper'] as const;

export const CARD_THEMES: Record<'light' | 'dark', Record<CardThemeName, CardThemePalette>> = {
  light: {
    // 明度 88〜92% / 彩度 15〜25%。テキスト #212121 との contrast 11〜15:1 で WCAG AAA を維持。
    // codeBackground は L 22〜27% / 彩度 50〜70%。テーマ色が「ディープフォレスト・ワインパープル」のように
    // はっきり視認できる濃色。VSCode Dark+ は WCAG AA で読める。
    default:  { background: '#FFFFFF', memoBackground: '#EFEFEF', border: '#F0F0F0', codeBackground: '#2A2A2A' },
    paper:    { background: '#F4E9CD', memoBackground: '#E8DCB5', border: '#D8C390', codeBackground: '#4A3010' },
    mint:     { background: '#D8EEDF', memoBackground: '#C0DECA', border: '#99C7B0', codeBackground: '#0F3D30' },
    graphite: { background: '#D2DAE5', memoBackground: '#BFC8D6', border: '#9DA8BC', codeBackground: '#1F2D5A' },
    lavender: { background: '#E5D8F0', memoBackground: '#D2C0E5', border: '#B498D2', codeBackground: '#4D1F75' },
    sepia:    { background: '#ECDCB0', memoBackground: '#DCC890', border: '#B89968', codeBackground: '#5A3315' },
    sky:      { background: '#DCEAFB', memoBackground: '#C8DCF3', border: '#9CC2EC', codeBackground: '#103A6B' },
    rose:     { background: '#F8DCE8', memoBackground: '#F0C6D8', border: '#E099B8', codeBackground: '#5A1033' },
  },
  dark: {
    // ダーク側も同じ方向性。本体背景より明らかに色味が立ち、コード領域が「深く色付いた箱」として見える。
    default:  { background: '#1E1E1E', memoBackground: '#383838', border: '#2C2C2C', codeBackground: '#2A2A2A' },
    paper:    { background: '#2E261A', memoBackground: '#423728', border: '#5A4A30', codeBackground: '#4A3210' },
    mint:     { background: '#1A2E2A', memoBackground: '#2A4238', border: '#3A5A4C', codeBackground: '#143D30' },
    graphite: { background: '#1E2638', memoBackground: '#2A344A', border: '#3F4D6A', codeBackground: '#162148' },
    lavender: { background: '#261E38', memoBackground: '#3A2E50', border: '#52426E', codeBackground: '#3A1A5A' },
    sepia:    { background: '#2E2418', memoBackground: '#423324', border: '#5A4632', codeBackground: '#42280A' },
    sky:      { background: '#16263F', memoBackground: '#26395A', border: '#3A567E', codeBackground: '#123E72' },
    rose:     { background: '#341F2A', memoBackground: '#4A2E3B', border: '#6E4255', codeBackground: '#5A1536' },
  },
};

/** 設定画面のサムネイル色（プリセットらしさを視認できる代表色） */
export function getCardThemeSwatch(name: CardThemeName, dark: boolean): string {
  return CARD_THEMES[dark ? 'dark' : 'light'][name].background;
}

/** テーマの濃い代表色（コード背景）。アイコン色など濃色が必要な箇所で使う */
export function getCardThemeAccentColor(name: CardThemeName, dark: boolean): string {
  return CARD_THEMES[dark ? 'dark' : 'light'][name].codeBackground;
}
