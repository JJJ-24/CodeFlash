import { Platform, useColorScheme } from 'react-native';

import { FONT_SCALE, useThemeStore } from '@/store/theme';

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
  xs: number;   // 12 — バーチャートラベル等の極小テキスト
  sm: number;   // 14 — サブラベル・説明文
  md: number;   // 16 — 本文・デッキ名等
  lg: number;   // 18 — セクションタイトル・モーダルタイトル
  xl: number;   // 20 — 大見出し
  xxl: number;  // 22 — 統計数値
}

const BASE_FONT_SIZE: AppFontSize = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, xxl: 22 };

export interface AppTheme {
  dark: boolean;
  colors: AppColors;
  fontScale: number;
  fontSize: AppFontSize;
}

export const lightTheme: Omit<AppTheme, 'fontScale' | 'fontSize'> = {
  dark: false,
  colors: {
    background: '#F5F5F5',
    surface: '#FFFFFF',
    text: '#212121',
    textSecondary: '#757575',
    textTertiary: '#9E9E9E',
    border: '#F0F0F0',
    inputBorder: '#E0E0E0',
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

export const darkTheme: Omit<AppTheme, 'fontScale' | 'fontSize'> = {
  dark: true,
  colors: {
    background: '#121212',
    surface: '#1E1E1E',
    text: '#E0E0E0',
    textSecondary: '#AAAAAA',
    textTertiary: '#757575',
    border: '#2C2C2C',
    inputBorder: '#3A3A3A',
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
export function fontSizeForDigits(theme: AppTheme, digits: number): number {
  if (digits >= 4) return Math.min(18, Math.max(14, theme.fontSize.md));
  if (digits >= 3) return Math.min(20, Math.max(16, theme.fontSize.lg));
  return Math.min(28, Math.max(20, theme.fontSize.xxl));
}

export function useTheme(): AppTheme {
  const systemScheme = useColorScheme();
  const preference = useThemeStore((s) => s.preference);
  const fontSizePreference = useThemeStore((s) => s.fontSizePreference);

  const base = preference === 'light' ? lightTheme : preference === 'dark' ? darkTheme : (systemScheme === 'dark' ? darkTheme : lightTheme);
  const scale = FONT_SCALE[fontSizePreference];
  return {
    ...base,
    fontScale: scale,
    fontSize: {
      xs:  Math.round(BASE_FONT_SIZE.xs  * scale),
      sm:  Math.round(BASE_FONT_SIZE.sm  * scale),
      md:  Math.round(BASE_FONT_SIZE.md  * scale),
      lg:  Math.round(BASE_FONT_SIZE.lg  * scale),
      xl:  Math.round(BASE_FONT_SIZE.xl  * scale),
      xxl: Math.round(BASE_FONT_SIZE.xxl * scale),
    },
  };
}
