import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';
import { create } from 'zustand';

export type ColorSchemePreference = 'light' | 'dark' | 'system';
export type FontSizePreference = 'small' | 'medium' | 'large';

export const FONT_SCALE: Record<FontSizePreference, number> = {
  small: 0.85,
  medium: 1.0,
  large: 1.2,
};

const THEME_KEY = '@codeflash_theme';
const FONT_SIZE_KEY = '@codeflash_font_size';

interface ThemeState {
  preference: ColorSchemePreference;
  fontSizePreference: FontSizePreference;
  hydrated: boolean;
  setPreference: (preference: ColorSchemePreference) => void;
  setFontSizePreference: (fontSizePreference: FontSizePreference) => void;
}

function applyNativeColorScheme(preference: ColorSchemePreference) {
  Appearance.setColorScheme(preference === 'system' ? null : preference);
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: 'system',
  fontSizePreference: 'medium',
  hydrated: false,
  setPreference: (preference) => {
    set({ preference });
    AsyncStorage.setItem(THEME_KEY, preference);
    applyNativeColorScheme(preference);
  },
  setFontSizePreference: (fontSizePreference) => {
    set({ fontSizePreference });
    AsyncStorage.setItem(FONT_SIZE_KEY, fontSizePreference);
  },
}));

// アプリ起動時に保存済みの設定を復元
Promise.all([
  AsyncStorage.getItem(THEME_KEY),
  AsyncStorage.getItem(FONT_SIZE_KEY),
]).then(([theme, fontSize]) => {
  const preference = (theme === 'light' || theme === 'dark' || theme === 'system') ? theme : 'system';
  const fontSizePreference = (fontSize === 'small' || fontSize === 'medium' || fontSize === 'large') ? fontSize : 'medium';
  applyNativeColorScheme(preference);
  useThemeStore.setState({ preference, fontSizePreference, hydrated: true });
});
