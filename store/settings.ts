import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { create } from 'zustand';

import i18n from '@/lib/i18n';
import { CARD_THEME_NAMES, type CardThemeName } from '@/lib/theme/cardThemes';

const STORAGE_KEY = '@codeflash_keyboard_shortcuts';
const FILTER_STORAGE_KEY = '@codeflash_initial_filter';
const LANG_STORAGE_KEY = '@codeflash_last_code_language';
const DECK_FILTER_STORAGE_KEY = '@codeflash_last_deck_detail_filter';
const NOTIFICATION_ENABLED_KEY = '@codeflash_notification_enabled';
const NOTIFICATION_HOUR_KEY = '@codeflash_notification_hour';
const NOTIFICATION_MINUTE_KEY = '@codeflash_notification_minute';
const DECK_SORT_KEY = '@codeflash_deck_sort';
const DECK_SORT_LOCKED_KEY = '@codeflash_deck_sort_locked';
const TAG_SORT_KEY = '@codeflash_tag_sort';
const CARD_SORT_KEY = '@codeflash_card_sort';
const MANUAL_SORT_LOCKED_KEY = '@codeflash_manual_sort_locked';
const SHUFFLE_KEY = '@codeflash_shuffle';
const SEARCH_FIELD_KEY = '@codeflash_last_search_field';
const FSRS_RETENTION_KEY = '@codeflash_fsrs_retention';
const STUDY_HIDE_EMPTY_KEY = '@codeflash_study_hide_empty';
const GRADE_RANKING_BY_TIME_KEY = '@codeflash_grade_ranking_by_time';
const GRADE_RANKING_PERIOD_KEY = '@codeflash_grade_ranking_period';
const GRADE_RANKING_DECK_IDS_KEY = '@codeflash_grade_ranking_deck_ids';
const CARD_THEME_KEY = '@codeflash_card_theme';
const LANGUAGE_PREF_KEY = '@codeflash_language_pref';
const HOME_FILTER_KEY = '@codeflash_last_home_filter';
const TAG_CARD_FILTER_KEY = '@codeflash_last_tag_card_filter';

/** ホーム画面のデッキ絞り込み。active=有効デッキのみ / all=アーカイブ含む全デッキ */
export type HomeFilter = 'active' | 'all';

export type LanguagePreference = 'system' | 'ja' | 'en';

function resolveLanguage(pref: LanguagePreference): string {
  if (pref === 'system') {
    const deviceLang = getLocales()[0]?.languageCode ?? 'ja';
    return ['ja', 'en'].includes(deviceLang) ? deviceLang : 'en';
  }
  return pref;
}

export type DeckSortOrder = 'manual' | 'name' | 'cardCount';
export type CardSortOrder = 'manual' | 'newest' | 'oldest';
export type GradeRankingPeriod = 'all' | '90d' | '30d' | '7d';

export const GRADE_RANKING_PERIOD_DAYS: Record<GradeRankingPeriod, number | null> = {
  all: null,
  '90d': 90,
  '30d': 30,
  '7d': 7,
};

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
  // ホーム（デッキ一覧）「手動ソート」のドラッグ並べ替えロック（true=固定してスワイプ可）
  deckSortLocked: boolean;
  setDeckSortLocked: (v: boolean) => void;
  tagSortOrder: DeckSortOrder;
  setTagSortOrder: (v: DeckSortOrder) => void;
  cardSortOrder: CardSortOrder;
  setCardSortOrder: (v: CardSortOrder) => void;
  // カード一覧「すべて＋手動ソート」のドラッグ並べ替えロック（true=固定してスワイプ可）
  manualSortLocked: boolean;
  setManualSortLocked: (v: boolean) => void;
  shuffleEnabled: boolean;
  setShuffleEnabled: (v: boolean) => void;
  lastSearchField: string;
  setLastSearchField: (v: string) => void;
  fsrsDesiredRetention: number;
  setFsrsDesiredRetention: (v: number) => void;
  studyHideEmpty: boolean;
  setStudyHideEmpty: (v: boolean) => void;
  gradeRankingByTime: boolean;
  setGradeRankingByTime: (v: boolean) => void;
  gradeRankingPeriod: GradeRankingPeriod;
  setGradeRankingPeriod: (v: GradeRankingPeriod) => void;
  gradeRankingDeckIds: string[];
  setGradeRankingDeckIds: (v: string[]) => void;
  cardThemePreference: CardThemeName;
  setCardThemePreference: (v: CardThemeName) => void;
  languagePreference: LanguagePreference;
  setLanguagePreference: (v: LanguagePreference) => void;
  lastHomeFilter: HomeFilter;
  setLastHomeFilter: (v: HomeFilter) => void;
  lastTagCardFilter: HomeFilter;
  setLastTagCardFilter: (v: HomeFilter) => void;
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
  deckSortLocked: false,
  setDeckSortLocked: (v) => {
    set({ deckSortLocked: v });
    AsyncStorage.setItem(DECK_SORT_LOCKED_KEY, String(v));
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
  manualSortLocked: false,
  setManualSortLocked: (v) => {
    set({ manualSortLocked: v });
    AsyncStorage.setItem(MANUAL_SORT_LOCKED_KEY, String(v));
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
  gradeRankingByTime: false,
  setGradeRankingByTime: (v) => {
    set({ gradeRankingByTime: v });
    AsyncStorage.setItem(GRADE_RANKING_BY_TIME_KEY, String(v));
  },
  gradeRankingPeriod: 'all',
  setGradeRankingPeriod: (v) => {
    set({ gradeRankingPeriod: v });
    AsyncStorage.setItem(GRADE_RANKING_PERIOD_KEY, v);
  },
  gradeRankingDeckIds: [],
  setGradeRankingDeckIds: (v) => {
    set({ gradeRankingDeckIds: v });
    if (v.length === 0) AsyncStorage.removeItem(GRADE_RANKING_DECK_IDS_KEY);
    else AsyncStorage.setItem(GRADE_RANKING_DECK_IDS_KEY, JSON.stringify(v));
  },
  cardThemePreference: 'default',
  setCardThemePreference: (v) => {
    set({ cardThemePreference: v });
    AsyncStorage.setItem(CARD_THEME_KEY, v);
  },
  languagePreference: 'system',
  setLanguagePreference: (v) => {
    set({ languagePreference: v });
    AsyncStorage.setItem(LANGUAGE_PREF_KEY, v);
    i18n.changeLanguage(resolveLanguage(v));
  },
  lastHomeFilter: 'active',
  setLastHomeFilter: (v) => {
    set({ lastHomeFilter: v });
    AsyncStorage.setItem(HOME_FILTER_KEY, v);
  },
  lastTagCardFilter: 'active',
  setLastTagCardFilter: (v) => {
    set({ lastTagCardFilter: v });
    AsyncStorage.setItem(TAG_CARD_FILTER_KEY, v);
  },
}));

export async function hydrateSettings(): Promise<void> {
  const [keyboard, filter, lang, deckFilter, notifEnabled, deckSort, deckSortLocked, tagSort, cardSort, manualSortLocked, shuffle, notifHour, notifMinute, searchField, fsrsRetention, studyHideEmpty, gradeRankingByTime, gradeRankingPeriod, gradeRankingDeckIds, cardTheme, languagePref, homeFilter, tagCardFilter] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEY),
    AsyncStorage.getItem(FILTER_STORAGE_KEY),
    AsyncStorage.getItem(LANG_STORAGE_KEY),
    AsyncStorage.getItem(DECK_FILTER_STORAGE_KEY),
    AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY),
    AsyncStorage.getItem(DECK_SORT_KEY),
    AsyncStorage.getItem(DECK_SORT_LOCKED_KEY),
    AsyncStorage.getItem(TAG_SORT_KEY),
    AsyncStorage.getItem(CARD_SORT_KEY),
    AsyncStorage.getItem(MANUAL_SORT_LOCKED_KEY),
    AsyncStorage.getItem(SHUFFLE_KEY),
    AsyncStorage.getItem(NOTIFICATION_HOUR_KEY),
    AsyncStorage.getItem(NOTIFICATION_MINUTE_KEY),
    AsyncStorage.getItem(SEARCH_FIELD_KEY),
    AsyncStorage.getItem(FSRS_RETENTION_KEY),
    AsyncStorage.getItem(STUDY_HIDE_EMPTY_KEY),
    AsyncStorage.getItem(GRADE_RANKING_BY_TIME_KEY),
    AsyncStorage.getItem(GRADE_RANKING_PERIOD_KEY),
    AsyncStorage.getItem(GRADE_RANKING_DECK_IDS_KEY),
    AsyncStorage.getItem(CARD_THEME_KEY),
    AsyncStorage.getItem(LANGUAGE_PREF_KEY),
    AsyncStorage.getItem(HOME_FILTER_KEY),
    AsyncStorage.getItem(TAG_CARD_FILTER_KEY),
  ]);
  const update: Partial<Pick<SettingsState,
    'keyboardShortcutsEnabled' | 'initialFilterPreference' | 'lastSelectedCodeLanguage' |
    'lastDeckDetailFilter' | 'notificationEnabled' | 'notificationHour' | 'notificationMinute' |
    'deckSortOrder' | 'deckSortLocked' | 'tagSortOrder' | 'cardSortOrder' | 'manualSortLocked' | 'shuffleEnabled' | 'lastSearchField' |
    'fsrsDesiredRetention' | 'studyHideEmpty' | 'gradeRankingByTime' | 'gradeRankingPeriod' | 'gradeRankingDeckIds' |
    'cardThemePreference' | 'languagePreference' | 'lastHomeFilter' | 'lastTagCardFilter'
  >> = {};
  if (keyboard !== null) update.keyboardShortcutsEnabled = keyboard === 'true';
  if (filter !== null) update.initialFilterPreference = filter as InitialFilterPreference;
  if (lang !== null) update.lastSelectedCodeLanguage = lang;
  if (deckFilter !== null) update.lastDeckDetailFilter = deckFilter as DeckDetailFilter;
  if (notifEnabled !== null) update.notificationEnabled = notifEnabled === 'true';
  if (deckSort !== null) update.deckSortOrder = deckSort as DeckSortOrder;
  if (deckSortLocked !== null) update.deckSortLocked = deckSortLocked === 'true';
  if (tagSort !== null) update.tagSortOrder = tagSort as DeckSortOrder;
  if (cardSort !== null) update.cardSortOrder = cardSort as CardSortOrder;
  if (manualSortLocked !== null) update.manualSortLocked = manualSortLocked === 'true';
  if (shuffle !== null) update.shuffleEnabled = shuffle === 'true';
  if (notifHour !== null) update.notificationHour = Number(notifHour);
  if (notifMinute !== null) update.notificationMinute = Number(notifMinute);
  if (searchField !== null) update.lastSearchField = searchField;
  if (fsrsRetention !== null) {
    const v = Number(fsrsRetention);
    if (!Number.isNaN(v)) update.fsrsDesiredRetention = Math.max(FSRS_RETENTION_MIN, Math.min(FSRS_RETENTION_MAX, v));
  }
  if (studyHideEmpty !== null) update.studyHideEmpty = studyHideEmpty === 'true';
  if (gradeRankingByTime !== null) update.gradeRankingByTime = gradeRankingByTime === 'true';
  if (gradeRankingPeriod !== null && (gradeRankingPeriod === 'all' || gradeRankingPeriod === '90d' || gradeRankingPeriod === '30d' || gradeRankingPeriod === '7d')) {
    update.gradeRankingPeriod = gradeRankingPeriod;
  }
  if (gradeRankingDeckIds !== null) {
    try {
      const parsed = JSON.parse(gradeRankingDeckIds);
      if (Array.isArray(parsed)) update.gradeRankingDeckIds = parsed;
    } catch { /* ignore */ }
  }
  if (cardTheme !== null && (CARD_THEME_NAMES as readonly string[]).includes(cardTheme)) {
    update.cardThemePreference = cardTheme as CardThemeName;
  }
  if (languagePref !== null && ['system', 'ja', 'en'].includes(languagePref)) {
    update.languagePreference = languagePref as LanguagePreference;
    i18n.changeLanguage(resolveLanguage(languagePref as LanguagePreference));
  }
  if (homeFilter === 'active' || homeFilter === 'all') update.lastHomeFilter = homeFilter;
  if (tagCardFilter === 'active' || tagCardFilter === 'all') update.lastTagCardFilter = tagCardFilter;
  if (Object.keys(update).length > 0) useSettingsStore.setState(update);
}

hydrateSettings();
