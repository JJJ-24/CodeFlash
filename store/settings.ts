import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = '@codeflash_keyboard_shortcuts';
const FILTER_STORAGE_KEY = '@codeflash_initial_filter';
const LANG_STORAGE_KEY = '@codeflash_last_code_language';
const DECK_FILTER_STORAGE_KEY = '@codeflash_last_deck_detail_filter';
const NOTIFICATION_ENABLED_KEY = '@codeflash_notification_enabled';
const NOTIFICATION_HOUR_KEY = '@codeflash_notification_hour';
const NOTIFICATION_MINUTE_KEY = '@codeflash_notification_minute';

export type InitialFilterPreference = 'all' | 'learned' | 'review' | 'new' | 'none';
export type DeckDetailFilter = Exclude<InitialFilterPreference, 'none'>;

export const SESSION_FILTER_MAP: Record<DeckDetailFilter, 'all' | 'today' | 'due' | 'unlearned'> = {
  all:     'all',
  learned: 'today',
  review:  'due',
  new:     'unlearned',
};

/** 'none' は null を返す。それ以外は DeckDetailFilter としてそのまま返す */
export function preferenceToFilter(pref: InitialFilterPreference): DeckDetailFilter | null {
  return pref === 'none' ? null : pref;
}

interface SettingsState {
  keyboardShortcutsEnabled: boolean;
  setKeyboardShortcutsEnabled: (v: boolean) => void;
  initialFilterPreference: InitialFilterPreference;
  setInitialFilterPreference: (v: InitialFilterPreference) => void;
  lastSelectedCodeLanguage: string;
  setLastSelectedCodeLanguage: (v: string) => void;
  lastDeckDetailFilter: DeckDetailFilter;
  setLastDeckDetailFilter: (v: DeckDetailFilter) => void;
  notificationEnabled: boolean;
  notificationHour: number;
  notificationMinute: number;
  setNotificationEnabled: (v: boolean) => void;
  setNotificationTime: (hour: number, minute: number) => void;
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
  lastSelectedCodeLanguage: 'javascript',
  setLastSelectedCodeLanguage: (v) => {
    set({ lastSelectedCodeLanguage: v });
    AsyncStorage.setItem(LANG_STORAGE_KEY, v);
  },
  lastDeckDetailFilter: 'review',
  setLastDeckDetailFilter: (v) => {
    set({ lastDeckDetailFilter: v });
    AsyncStorage.setItem(DECK_FILTER_STORAGE_KEY, v);
  },
  notificationEnabled: false,
  notificationHour: 9,
  notificationMinute: 0,
  setNotificationEnabled: (v) => {
    set({ notificationEnabled: v });
    AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, String(v));
  },
  setNotificationTime: (hour, minute) => {
    set({ notificationHour: hour, notificationMinute: minute });
    AsyncStorage.setItem(NOTIFICATION_HOUR_KEY, String(hour));
    AsyncStorage.setItem(NOTIFICATION_MINUTE_KEY, String(minute));
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

AsyncStorage.getItem(LANG_STORAGE_KEY).then((value) => {
  if (value !== null) {
    useSettingsStore.setState({ lastSelectedCodeLanguage: value });
  }
});

AsyncStorage.getItem(DECK_FILTER_STORAGE_KEY).then((value) => {
  if (value !== null) {
    useSettingsStore.setState({ lastDeckDetailFilter: value as DeckDetailFilter });
  }
});

AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY).then((value) => {
  if (value !== null) {
    useSettingsStore.setState({ notificationEnabled: value === 'true' });
  }
});

Promise.all([
  AsyncStorage.getItem(NOTIFICATION_HOUR_KEY),
  AsyncStorage.getItem(NOTIFICATION_MINUTE_KEY),
]).then(([hour, minute]) => {
  const update: Partial<{ notificationHour: number; notificationMinute: number }> = {};
  if (hour !== null) update.notificationHour = Number(hour);
  if (minute !== null) update.notificationMinute = Number(minute);
  if (Object.keys(update).length > 0) useSettingsStore.setState(update);
});
