import { useColorScheme } from 'react-native';

export interface AppColors {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  primary: string;
  primaryText: string;
  danger: string;
  icon: string;
  iconSubtle: string;
  progressBg: string;
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
    primary: '#1976D2',
    primaryText: '#FFFFFF',
    danger: '#E53935',
    icon: '#666666',
    iconSubtle: '#BDBDBD',
    progressBg: '#E0E0E0',
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
    primary: '#1976D2',
    primaryText: '#FFFFFF',
    danger: '#E53935',
    icon: '#9E9E9E',
    iconSubtle: '#555555',
    progressBg: '#333333',
  },
};

export function useTheme(): AppTheme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}
