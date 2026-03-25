import { useColorScheme } from 'react-native';

import { FONT_SCALE, useThemeStore } from '@/store/theme';

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
  xxl: number;  // 26 — 統計数値
}

const BASE_FONT_SIZE: AppFontSize = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, xxl: 26 };

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
