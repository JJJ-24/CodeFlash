import { Platform, useColorScheme } from 'react-native';

import { FONT_SCALE, useThemeStore } from '@/store/theme';
import { useSettingsStore } from '@/store/settings';
import { useProStore } from '@/store/pro';
import { CARD_THEMES, FREE_CARD_THEMES, type CardThemePalette, type CardThemeName } from '@/lib/theme/cardThemes';

const isPad = (Platform as any).isPad;

/**
 * デバイス種別ごとの maxFontSizeMultiplier 定数。
 * - ui:      ヘッダー・ボタン・一般テキスト（幅が限られる箇所）
 * - content: リスト項目名・統計数字等（縦スクロールで高さが伸びるため大きめ許容）
 * - label:   凡例ラベル等（幅制約があるため iPhone では ui と同値）
 */
export const MAX_FONT_MULTIPLIER = {
  ui:      isPad ? 1.8 : 1.3,
  label:   isPad ? 2.3 : 1.4,
  content: isPad ? 2.5 : 1.5,
} as const;

export interface AppColors {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  inputBorder: string;
  buttonBorder: string;
  primary: string;
  primaryText: string;
  primaryLight: string;
  danger: string;
  icon: string;
  iconSubtle: string;
  progressBg: string;
  codeBackground: string;
  memoBackground: string;
}

export interface AppFontSize {
  xs: number;    // 12 — バーチャートラベル等の極小テキスト
  sm: number;    // 14 — サブラベル・説明文
  md: number;    // 16 — 本文・デッキ名等
  lg: number;    // 18 — セクションタイトル・モーダルタイトル
  xl: number;    // 20 — 大見出し
  xxl: number;   // 22 — 統計数値
  xxxl: number;  // 28 — フィルターブロック大数値
}

const BASE_FONT_SIZE: AppFontSize = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, xxl: 22, xxxl: 28 };

export interface AppTheme {
  dark: boolean;
  colors: AppColors;
  fontScale: number;
  fontSize: AppFontSize;
  /** 学習画面のカードテーマ（028-2）。学習画面以外では参照しない */
  cardTheme: CardThemePalette;
  /** カードテーマで色付けする前の素の画面背景。カードテーマの色付けを無視したい
   *  箇所（学習画面の背景＝カードを浮き立たせたい等）で使う。 */
  baseBackground: string;
  /** カードテーマの色付けを無視した素のカード面色（無彩色）。ダーク＋非デフォルトテーマでは
   *  colors.surface を濃い黒に振り替えるため、学習画面など現状維持したい箇所はこちらを使う。 */
  baseSurface: string;
}

export const lightTheme: Omit<AppTheme, 'fontScale' | 'fontSize' | 'cardTheme' | 'baseBackground' | 'baseSurface'> = {
  dark: false,
  colors: {
    background: '#F5F5F5',
    surface: '#FFFFFF',
    text: '#212121',
    textSecondary: '#757575',
    textTertiary: '#9E9E9E',
    border: '#F0F0F0',
    inputBorder: '#E0E0E0',
    buttonBorder: '#D8D8D8',
    primary: '#1976D2',
    primaryText: '#FFFFFF',
    primaryLight: '#E3F2FD',
    danger: '#E53935',
    icon: '#666666',
    iconSubtle: '#BDBDBD',
    progressBg: '#E0E0E0',
    codeBackground: '#2A2A2A',
    memoBackground: '#EFEFEF',
  },
};

export const darkTheme: Omit<AppTheme, 'fontScale' | 'fontSize' | 'cardTheme' | 'baseBackground' | 'baseSurface'> = {
  dark: true,
  colors: {
    background: '#121212',
    surface: '#1E1E1E',
    text: '#E0E0E0',
    textSecondary: '#AAAAAA',
    textTertiary: '#757575',
    border: '#2C2C2C',
    inputBorder: '#3A3A3A',
    buttonBorder: '#2C2C2C',
    primary: '#1976D2',
    primaryText: '#FFFFFF',
    primaryLight: 'rgba(25, 118, 210, 0.15)',
    danger: '#E53935',
    icon: '#9E9E9E',
    iconSubtle: '#555555',
    progressBg: '#333333',
    codeBackground: '#2A2A2A',
    memoBackground: '#383838',
  },
};

export const FILTER_COLORS = {
  learned: '#4CAF50',
  due: '#F57C00',
} as const;

// タグ・デッキ共通のカラーパレット（唯一の定義元）。
// タグ作成/編集画面・TSVインポート時のタグ色割り当て・デッキカラーがすべてこれを参照する。
export const TAG_PRESET_COLORS = [
  '#E53935', '#fd9023', '#F6BF26', '#33B679',
  '#0B8043', '#039BE5', '#0e4cdd', '#7986CB',
  '#8E24AA', '#828080', '#795548', '#F48FB1',
] as const;

// デッキのカラーテーマ（028-1）。タグと同じパレットを採用。
export const DECK_PRESET_COLORS = TAG_PRESET_COLORS;

// アプリのプライマリーカラー。デッキ・タグの色ピッカー先頭＆新規作成時の既定色。
// light/dark とも同値（lightTheme/darkTheme の primary と一致）。
export const PRIMARY_COLOR = '#1976D2';

export const GRADE_COLORS = {
  again: '#E53935',
  hard:  '#FB8C00',
  good:  '#43A047',
  easy:  '#1976D2',
} as const;

export const SHADOW = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  subtle: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
} as const;

/** 数値の桁数に応じて統計ブロックの数字フォントサイズを返す。
 *  allowFontScaling={false} と組み合わせて使い、iOS Dynamic Type の影響を受けない絶対サイズを保証する。
 *  アプリ内フォントサイズ設定（small/medium/large）は反映しつつ、最小・最大を桁数ごとにクランプする。 */
export function fontSizeForDigits(theme: AppTheme, digits: number, scale = 1): number {
  let size: number;
  if (digits >= 5) size = Math.min(14, Math.max(14, theme.fontSize.sm));
  else if (digits >= 4) size = Math.min(18, Math.max(18, theme.fontSize.lg));
  else if (digits >= 3) size = Math.min(23, Math.max(20, theme.fontSize.xxl));
  else size = Math.min(30, Math.max(26, theme.fontSize.xxxl));
  return size * scale;
}

export function useTheme(): AppTheme {
  const systemScheme = useColorScheme();
  const preference = useThemeStore((s) => s.preference);
  const fontSizePreference = useThemeStore((s) => s.fontSizePreference);
  const cardThemePreference = useSettingsStore((s) => s.cardThemePreference);
  const isPro = useProStore((s) => s.isPro);

  const base = preference === 'light' ? lightTheme : preference === 'dark' ? darkTheme : (systemScheme === 'dark' ? darkTheme : lightTheme);
  const scale = FONT_SCALE[fontSizePreference];
  // Pro 失効時は無料配色（default / paper）以外を選んでいたら default にフォールバック
  // （ユーザーの選好値は保持し、再 Pro 時に自動復元）。無料配色はそのまま有効。
  const effectiveCardTheme: CardThemeName =
    isPro || FREE_CARD_THEMES.includes(cardThemePreference) ? cardThemePreference : 'default';
  const cardPalette = CARD_THEMES[base.dark ? 'dark' : 'light'][effectiveCardTheme];
  // カードテーマ選択時、画面背景（カード間の隙間）をテーマ色でほんのり色付けする。
  // ヘッダー・タブバー・各カード面はすべて colors.surface を使うため無彩色のまま保たれ、
  // 「白いカード／カラーの隙間」になる。default のときは従来の無彩色背景を維持する
  // （default の cardPalette.background は surface と同色のため、隙間が消えてしまうのを防ぐ）。
  const colors =
    effectiveCardTheme === 'default'
      ? base.colors
      : base.dark
        // ダーク＋非デフォルト：隙間（background）をテーマ色にし、カード面（surface）は
        // 素の濃い黒（デフォルトの background）に振り替えて、テーマ色の隙間にカードを沈ませる。
        ? { ...base.colors, background: cardPalette.background, surface: base.colors.background }
        // ライト：従来どおり隙間だけテーマ色付け（カードは白のまま）
        : { ...base.colors, background: cardPalette.background };
  return {
    ...base,
    colors,
    fontScale: scale,
    fontSize: {
      xs:  Math.round(BASE_FONT_SIZE.xs  * scale),
      sm:  Math.round(BASE_FONT_SIZE.sm  * scale),
      md:  Math.round(BASE_FONT_SIZE.md  * scale),
      lg:  Math.round(BASE_FONT_SIZE.lg  * scale),
      xl:   Math.round(BASE_FONT_SIZE.xl   * scale),
      xxl:  Math.round(BASE_FONT_SIZE.xxl  * scale),
      xxxl: Math.round(BASE_FONT_SIZE.xxxl * scale),
    },
    cardTheme: cardPalette,
    baseBackground: base.colors.background,
    baseSurface: base.colors.surface,
  };
}
