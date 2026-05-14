import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = '@codeflash_keyboard_shortcuts';
const FILTER_STORAGE_KEY = '@codeflash_initial_filter';
const LANG_STORAGE_KEY = '@codeflash_last_code_language';
const DECK_FILTER_STORAGE_KEY = '@codeflash_last_deck_detail_filter';
const NOTIFICATION_ENABLED_KEY = '@codeflash_notification_enabled';
const NOTIFICATION_HOUR_KEY = '@codeflash_notification_hour';
const NOTIFICATION_MINUTE_KEY = '@codeflash_notification_minute';
const DECK_SORT_KEY = '@codeflash_deck_sort';
const TAG_SORT_KEY = '@codeflash_tag_sort';
const CARD_SORT_KEY = '@codeflash_card_sort';
const SHUFFLE_KEY = '@codeflash_shuffle';
const SEARCH_FIELD_KEY = '@codeflash_last_search_field';
const FSRS_RETENTION_KEY = '@codeflash_fsrs_retention';
const STUDY_HIDE_EMPTY_KEY = '@codeflash_study_hide_empty';

export type DeckSortOrder = 'manual' | 'name' | 'cardCount';
export type CardSortOrder = 'manual' | 'newest' | 'oldest';

export type FsrsPreset = 'exam' | 'standard' | 'longTerm';

export const FSRS_PRESET_RETENTION: Record<FsrsPreset, number> = {
  exam:     0.95,
  standard: 0.90,
  longTerm: 0.80,
};

export const FSRS_RETENTION_MIN = 0.70;
export const FSRS_RETENTION_MAX = 0.99;
export const FSRS_RETENTION_DEFAULT = 0.90;

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
  deckSortOrder: DeckSortOrder;
  setDeckSortOrder: (v: DeckSortOrder) => void;
  tagSortOrder: DeckSortOrder;
  setTagSortOrder: (v: DeckSortOrder) => void;
  cardSortOrder: CardSortOrder;
  setCardSortOrder: (v: CardSortOrder) => void;
  shuffleEnabled: boolean;
  setShuffleEnabled: (v: boolean) => void;
  lastSearchField: string;
  setLastSearchField: (v: string) => void;
  fsrsDesiredRetention: number;
  setFsrsDesiredRetention: (v: number) => void;
  studyHideEmpty: boolean;
  setStudyHideEmpty: (v: boolean) => void;
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
  deckSortOrder: 'manual',
  setDeckSortOrder: (v) => {
    set({ deckSortOrder: v });
    AsyncStorage.setItem(DECK_SORT_KEY, v);
  },
  tagSortOrder: 'manual',
  setTagSortOrder: (v) => {
    set({ tagSortOrder: v });
    AsyncStorage.setItem(TAG_SORT_KEY, v);
  },
  cardSortOrder: 'manual',
  setCardSortOrder: (v) => {
    set({ cardSortOrder: v });
    AsyncStorage.setItem(CARD_SORT_KEY, v);
  },
  shuffleEnabled: false,
  setShuffleEnabled: (v) => {
    set({ shuffleEnabled: v });
    AsyncStorage.setItem(SHUFFLE_KEY, String(v));
  },
  lastSearchField: 'all',
  setLastSearchField: (v) => {
    set({ lastSearchField: v });
    AsyncStorage.setItem(SEARCH_FIELD_KEY, v);
  },
  fsrsDesiredRetention: FSRS_RETENTION_DEFAULT,
  setFsrsDesiredRetention: (v) => {
    const clamped = Math.max(FSRS_RETENTION_MIN, Math.min(FSRS_RETENTION_MAX, v));
    set({ fsrsDesiredRetention: clamped });
    AsyncStorage.setItem(FSRS_RETENTION_KEY, String(clamped));
  },
  studyHideEmpty: false,
  setStudyHideEmpty: (v) => {
    set({ studyHideEmpty: v });
    AsyncStorage.setItem(STUDY_HIDE_EMPTY_KEY, String(v));
  },
}));

export async function hydrateSettings(): Promise<void> {
  const [keyboard, filter, lang, deckFilter, notifEnabled, deckSort, tagSort, cardSort, shuffle, notifHour, notifMinute, searchField, fsrsRetention, studyHideEmpty] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEY),
    AsyncStorage.getItem(FILTER_STORAGE_KEY),
    AsyncStorage.getItem(LANG_STORAGE_KEY),
    AsyncStorage.getItem(DECK_FILTER_STORAGE_KEY),
    AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY),
    AsyncStorage.getItem(DECK_SORT_KEY),
    AsyncStorage.getItem(TAG_SORT_KEY),
    AsyncStorage.getItem(CARD_SORT_KEY),
    AsyncStorage.getItem(SHUFFLE_KEY),
    AsyncStorage.getItem(NOTIFICATION_HOUR_KEY),
    AsyncStorage.getItem(NOTIFICATION_MINUTE_KEY),
    AsyncStorage.getItem(SEARCH_FIELD_KEY),
    AsyncStorage.getItem(FSRS_RETENTION_KEY),
    AsyncStorage.getItem(STUDY_HIDE_EMPTY_KEY),
  ]);
  const update: Partial<Pick<SettingsState,
    'keyboardShortcutsEnabled' | 'initialFilterPreference' | 'lastSelectedCodeLanguage' |
    'lastDeckDetailFilter' | 'notificationEnabled' | 'notificationHour' | 'notificationMinute' |
    'deckSortOrder' | 'tagSortOrder' | 'cardSortOrder' | 'shuffleEnabled' | 'lastSearchField' |
    'fsrsDesiredRetention' | 'studyHideEmpty'
  >> = {};
  if (keyboard !== null) update.keyboardShortcutsEnabled = keyboard === 'true';
  if (filter !== null) update.initialFilterPreference = filter as InitialFilterPreference;
  if (lang !== null) update.lastSelectedCodeLanguage = lang;
  if (deckFilter !== null) update.lastDeckDetailFilter = deckFilter as DeckDetailFilter;
  if (notifEnabled !== null) update.notificationEnabled = notifEnabled === 'true';
  if (deckSort !== null) update.deckSortOrder = deckSort as DeckSortOrder;
  if (tagSort !== null) update.tagSortOrder = tagSort as DeckSortOrder;
  if (cardSort !== null) update.cardSortOrder = cardSort as CardSortOrder;
  if (shuffle !== null) update.shuffleEnabled = shuffle === 'true';
  if (notifHour !== null) update.notificationHour = Number(notifHour);
  if (notifMinute !== null) update.notificationMinute = Number(notifMinute);
  if (searchField !== null) update.lastSearchField = searchField;
  if (fsrsRetention !== null) {
    const v = Number(fsrsRetention);
    if (!Number.isNaN(v)) update.fsrsDesiredRetention = Math.max(FSRS_RETENTION_MIN, Math.min(FSRS_RETENTION_MAX, v));
  }
  if (studyHideEmpty !== null) update.studyHideEmpty = studyHideEmpty === 'true';
  if (Object.keys(update).length > 0) useSettingsStore.setState(update);
}

hydrateSettings();
