import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = '@codeflash_keyboard_shortcuts';
const FILTER_STORAGE_KEY = '@codeflash_initial_filter';

export type InitialFilterPreference = 'all' | 'learned' | 'review' | 'new' | 'none';

interface SettingsState {
  keyboardShortcutsEnabled: boolean;
  setKeyboardShortcutsEnabled: (v: boolean) => void;
  initialFilterPreference: InitialFilterPreference;
  setInitialFilterPreference: (v: InitialFilterPreference) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  keyboardShortcutsEnabled: true,
  setKeyboardShortcutsEnabled: (v) => {
    set({ keyboardShortcutsEnabled: v });
    AsyncStorage.setItem(STORAGE_KEY, String(v));
  },
  initialFilterPreference: 'review',
  setInitialFilterPreference: (v) => {
    set({ initialFilterPreference: v });
    AsyncStorage.setItem(FILTER_STORAGE_KEY, v);
  },
}));

AsyncStorage.getItem(STORAGE_KEY).then((value) => {
  if (value !== null) {
    useSettingsStore.setState({ keyboardShortcutsEnabled: value === 'true' });
  }
});

AsyncStorage.getItem(FILTER_STORAGE_KEY).then((value) => {
  if (value !== null) {
    useSettingsStore.setState({ initialFilterPreference: value as InitialFilterPreference });
  }
});
