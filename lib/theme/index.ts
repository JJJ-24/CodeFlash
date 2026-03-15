import { useColorScheme } from 'react-native';

import { useThemeStore } from '@/store/theme';

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

export interface AppTheme {
  dark: boolean;
  colors: AppColors;
}

export const lightTheme: AppTheme = {
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

export const darkTheme: AppTheme = {
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

export function useTheme(): AppTheme {
  const systemScheme = useColorScheme();
  const preference = useThemeStore((s) => s.preference);

  if (preference === 'light') return lightTheme;
  if (preference === 'dark') return darkTheme;
  return systemScheme === 'dark' ? darkTheme : lightTheme;
}
