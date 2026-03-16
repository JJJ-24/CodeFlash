import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type ColorSchemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = '@codeflash_theme';

interface ThemeState {
  preference: ColorSchemePreference;
  hydrated: boolean;
  setPreference: (preference: ColorSchemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: 'system',
  hydrated: false,
  setPreference: (preference) => {
    set({ preference });
    AsyncStorage.setItem(STORAGE_KEY, preference);
  },
}));

// アプリ起動時に保存済みの設定を復元
AsyncStorage.getItem(STORAGE_KEY).then((value) => {
  if (value === 'light' || value === 'dark' || value === 'system') {
    useThemeStore.setState({ preference: value, hydrated: true });
  } else {
    useThemeStore.setState({ hydrated: true });
  }
});
