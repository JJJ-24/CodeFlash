import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { create } from 'zustand';

import i18n from '@/lib/i18n';
import { cancelBreakEndNotification } from '@/lib/notifications';
import { CARD_THEME_NAMES, type CardThemeName } from '@/lib/theme/cardThemes';
import { useStudyTimerStore } from '@/store/studyTimer';

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

const clampRetention = (v: number) => Math.max(FSRS_RETENTION_MIN, Math.min(FSRS_RETENTION_MAX, v));

/** 学習タイマーの終了時動作。alert=バイブ＋モーダル / blink=リング点滅のみ */
export type StudyTimerEndBehavior = 'alert' | 'blink';

export const STUDY_TIMER_MINUTES_MIN = 1;
export const STUDY_TIMER_MINUTES_MAX = 60;
export const STUDY_TIMER_MINUTES_DEFAULT = 10;

const clampTimerMinutes = (v: number) =>
  Math.max(STUDY_TIMER_MINUTES_MIN, Math.min(STUDY_TIMER_MINUTES_MAX, Math.round(v)));

// ポモドーロ拡張（039）: 休憩時間と繰り返し回数。回数1（既定）＝従来の単発タイマーと同一挙動。
export const STUDY_TIMER_BREAK_MINUTES_MIN = 1;
export const STUDY_TIMER_BREAK_MINUTES_MAX = 30;
export const STUDY_TIMER_BREAK_MINUTES_DEFAULT = 5;

const clampBreakMinutes = (v: number) =>
  Math.max(STUDY_TIMER_BREAK_MINUTES_MIN, Math.min(STUDY_TIMER_BREAK_MINUTES_MAX, Math.round(v)));

export const STUDY_TIMER_CYCLES_MIN = 1;
export const STUDY_TIMER_CYCLES_MAX = 12;
export const STUDY_TIMER_CYCLES_DEFAULT = 1;

const clampTimerCycles = (v: number) =>
  Math.max(STUDY_TIMER_CYCLES_MIN, Math.min(STUDY_TIMER_CYCLES_MAX, Math.round(v)));

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

/** 設定値（永続化対象）。setter は SettingsState 側で定義する。 */
interface SettingsValues {
  keyboardShortcutsEnabled: boolean;
  initialFilterPreference: InitialFilterPreference;
  lastSelectedCodeLanguage: string;
  lastDeckDetailFilter: DeckDetailFilter;
  notificationEnabled: boolean;
  notificationHour: number;
  notificationMinute: number;
  deckSortOrder: DeckSortOrder;
  // ホーム（デッキ一覧）「手動ソート」のドラッグ並べ替えロック（true=固定してスワイプ可）
  deckSortLocked: boolean;
  tagSortOrder: DeckSortOrder;
  // タグ管理「手動ソート」のドラッグ並べ替えロック（true=固定してスワイプ可）
  tagSortLocked: boolean;
  cardSortOrder: CardSortOrder;
  // カード一覧「すべて＋手動ソート」のドラッグ並べ替えロック（true=固定してスワイプ可）
  manualSortLocked: boolean;
  shuffleEnabled: boolean;
  lastSearchField: string;
  fsrsDesiredRetention: number;
  studyHideEmpty: boolean;
  gradeRankingByTime: boolean;
  gradeRankingPeriod: GradeRankingPeriod;
  gradeRankingDeckIds: string[];
  // 統計タブで折りたたみ中のセクションID（'chart'|'heatmap'|'today'|'total'|'mastery'|'pro'）
  statsCollapsedSections: string[];
  cardThemePreference: CardThemeName;
  languagePreference: LanguagePreference;
  lastHomeFilter: HomeFilter;
  lastTagCardFilter: HomeFilter;
  studyTimerEnabled: boolean;
  studyTimerMinutes: number;
  studyTimerRingVisible: boolean;
  studyTimerShowTime: boolean;
  studyTimerEndBehavior: StudyTimerEndBehavior;
  studyTimerBreakMinutes: number;
  studyTimerCycles: number;
}

/**
 * 設定1件分の永続化定義。
 * - `key`: AsyncStorage キー。**変更するとユーザーの既存設定が読めなくなるため厳守**
 *   （エクスポート対象キーは lib/settings-keys.ts が別途参照する）。
 * - `parse`: 保存文字列 → 値。`undefined` を返すと無効値として無視（既定値のまま）。
 * - `normalize`: setter での正規化（clamp 等）。
 * - `persist`: 既定の `AsyncStorage.setItem(key, String(v))` を差し替える（配列の JSON 化等）。
 * - `onApply`: setter 適用時・hydrate 成功時の副作用（言語切替等）。
 */
interface SettingDef<T> {
  key: string;
  default: T;
  parse: (raw: string) => T | undefined;
  normalize?: (v: T) => T;
  persist?: (v: T) => void;
  onApply?: (v: T) => void;
}

const asIs = (raw: string) => raw;
const asBool = (raw: string) => raw === 'true';
const asNum = (raw: string) => Number(raw);
const oneOf = <T extends string>(values: readonly T[]) => (raw: string): T | undefined =>
  (values as readonly string[]).includes(raw) ? (raw as T) : undefined;

const GRADE_RANKING_DECK_IDS_KEY = '@codeflash_grade_ranking_deck_ids';
const STATS_COLLAPSED_SECTIONS_KEY = '@codeflash_stats_collapsed_sections';

// 作動中（一時停止含む）にタイマー設定（分数/休憩/回数）を変更したら計り直す（旧い残り時間の
// ままだと設定が効いていないように見えるため）。次の学習開始時に新しい設定でスタートする。
// hydrate 時にも呼ばれるが、起動直後はタイマー未開始（idle）なので無害。
// 休憩中だった場合は予約済みの休憩終了通知も掃除する（039・休憩開始時予約方式）。
const resetStudyTimerIfActive = () => {
  const st = useStudyTimerStore.getState();
  if (st.phase !== 'idle') {
    const wasBreak = st.mode === 'break';
    st.reset();
    if (wasBreak) cancelBreakEndNotification();
  }
};

const DEFS: { [K in keyof SettingsValues]: SettingDef<SettingsValues[K]> } = {
  keyboardShortcutsEnabled: { key: '@codeflash_keyboard_shortcuts', default: true, parse: asBool },
  initialFilterPreference: { key: '@codeflash_initial_filter', default: 'review', parse: (r) => r as InitialFilterPreference },
  lastSelectedCodeLanguage: { key: '@codeflash_last_code_language', default: 'javascript', parse: asIs },
  lastDeckDetailFilter: { key: '@codeflash_last_deck_detail_filter', default: 'review', parse: (r) => r as DeckDetailFilter },
  notificationEnabled: { key: '@codeflash_notification_enabled', default: false, parse: asBool },
  notificationHour: { key: '@codeflash_notification_hour', default: 9, parse: asNum },
  notificationMinute: { key: '@codeflash_notification_minute', default: 0, parse: asNum },
  deckSortOrder: { key: '@codeflash_deck_sort', default: 'manual', parse: (r) => r as DeckSortOrder },
  deckSortLocked: { key: '@codeflash_deck_sort_locked', default: false, parse: asBool },
  tagSortOrder: { key: '@codeflash_tag_sort', default: 'manual', parse: (r) => r as DeckSortOrder },
  tagSortLocked: { key: '@codeflash_tag_sort_locked', default: false, parse: asBool },
  cardSortOrder: { key: '@codeflash_card_sort', default: 'manual', parse: (r) => r as CardSortOrder },
  manualSortLocked: { key: '@codeflash_manual_sort_locked', default: false, parse: asBool },
  shuffleEnabled: { key: '@codeflash_shuffle', default: false, parse: asBool },
  lastSearchField: { key: '@codeflash_last_search_field', default: 'all', parse: asIs },
  fsrsDesiredRetention: {
    key: '@codeflash_fsrs_retention',
    default: FSRS_RETENTION_DEFAULT,
    parse: (r) => { const v = Number(r); return Number.isNaN(v) ? undefined : clampRetention(v); },
    normalize: clampRetention,
  },
  studyHideEmpty: { key: '@codeflash_study_hide_empty', default: false, parse: asBool },
  gradeRankingByTime: { key: '@codeflash_grade_ranking_by_time', default: false, parse: asBool },
  gradeRankingPeriod: { key: '@codeflash_grade_ranking_period', default: 'all', parse: oneOf(['all', '90d', '30d', '7d'] as const) },
  gradeRankingDeckIds: {
    key: GRADE_RANKING_DECK_IDS_KEY,
    default: [],
    parse: (r) => {
      try {
        const parsed = JSON.parse(r);
        return Array.isArray(parsed) ? parsed : undefined;
      } catch { return undefined; }
    },
    // 空配列（=絞り込みなし）はキー自体を消す。
    persist: (v) => {
      if (v.length === 0) AsyncStorage.removeItem(GRADE_RANKING_DECK_IDS_KEY);
      else AsyncStorage.setItem(GRADE_RANKING_DECK_IDS_KEY, JSON.stringify(v));
    },
  },
  statsCollapsedSections: {
    key: STATS_COLLAPSED_SECTIONS_KEY,
    default: [],
    parse: (r) => {
      try {
        const parsed = JSON.parse(r);
        return Array.isArray(parsed) ? parsed : undefined;
      } catch { return undefined; }
    },
    // 空配列（=すべて展開）はキー自体を消す。
    persist: (v) => {
      if (v.length === 0) AsyncStorage.removeItem(STATS_COLLAPSED_SECTIONS_KEY);
      else AsyncStorage.setItem(STATS_COLLAPSED_SECTIONS_KEY, JSON.stringify(v));
    },
  },
  cardThemePreference: {
    key: '@codeflash_card_theme',
    default: 'default',
    parse: (r) => ((CARD_THEME_NAMES as readonly string[]).includes(r) ? (r as CardThemeName) : undefined),
  },
  languagePreference: {
    key: '@codeflash_language_pref',
    default: 'system',
    parse: oneOf(['system', 'ja', 'en'] as const),
    onApply: (v) => { i18n.changeLanguage(resolveLanguage(v)); },
  },
  lastHomeFilter: { key: '@codeflash_last_home_filter', default: 'active', parse: oneOf(['active', 'all'] as const) },
  lastTagCardFilter: { key: '@codeflash_last_tag_card_filter', default: 'active', parse: oneOf(['active', 'all'] as const) },
  studyTimerEnabled: {
    key: '@codeflash_study_timer_enabled',
    default: false,
    // OFF にしたら作動中タイマーを即リセットする（039: 休憩中に OFF にした場合、予約済みの
    // 休憩終了通知を残さないため。従来の「次回セッションマウント時に掃除」だと通知だけ先に鳴り得る）。
    // hydrate 時（起動直後＝idle）は無害。
    parse: asBool,
    onApply: (v) => { if (!v) resetStudyTimerIfActive(); },
  },
  studyTimerMinutes: {
    key: '@codeflash_study_timer_minutes',
    default: STUDY_TIMER_MINUTES_DEFAULT,
    parse: (r) => { const v = Number(r); return Number.isNaN(v) ? undefined : clampTimerMinutes(v); },
    normalize: clampTimerMinutes,
    onApply: resetStudyTimerIfActive,
  },
  studyTimerRingVisible: { key: '@codeflash_study_timer_ring_visible', default: true, parse: asBool },
  studyTimerShowTime: { key: '@codeflash_study_timer_show_time', default: false, parse: asBool },
  studyTimerEndBehavior: { key: '@codeflash_study_timer_end_behavior', default: 'alert', parse: oneOf(['alert', 'blink'] as const) },
  studyTimerBreakMinutes: {
    key: '@codeflash_study_timer_break_minutes',
    default: STUDY_TIMER_BREAK_MINUTES_DEFAULT,
    parse: (r) => { const v = Number(r); return Number.isNaN(v) ? undefined : clampBreakMinutes(v); },
    normalize: clampBreakMinutes,
    onApply: resetStudyTimerIfActive,
  },
  studyTimerCycles: {
    key: '@codeflash_study_timer_cycles',
    default: STUDY_TIMER_CYCLES_DEFAULT,
    parse: (r) => { const v = Number(r); return Number.isNaN(v) ? undefined : clampTimerCycles(v); },
    normalize: clampTimerCycles,
    onApply: resetStudyTimerIfActive,
  },
};

const SETTING_KEYS = Object.keys(DEFS) as (keyof SettingsValues)[];

const DEFAULTS = Object.fromEntries(
  SETTING_KEYS.map((k) => [k, DEFS[k].default]),
) as unknown as SettingsValues;

interface SettingsState extends SettingsValues {
  setKeyboardShortcutsEnabled: (v: boolean) => void;
  setInitialFilterPreference: (v: InitialFilterPreference) => void;
  setLastSelectedCodeLanguage: (v: string) => void;
  setLastDeckDetailFilter: (v: DeckDetailFilter) => void;
  setNotificationEnabled: (v: boolean) => void;
  setNotificationTime: (hour: number, minute: number) => void;
  setDeckSortOrder: (v: DeckSortOrder) => void;
  setDeckSortLocked: (v: boolean) => void;
  setTagSortOrder: (v: DeckSortOrder) => void;
  setTagSortLocked: (v: boolean) => void;
  setCardSortOrder: (v: CardSortOrder) => void;
  setManualSortLocked: (v: boolean) => void;
  setShuffleEnabled: (v: boolean) => void;
  setLastSearchField: (v: string) => void;
  setFsrsDesiredRetention: (v: number) => void;
  setStudyHideEmpty: (v: boolean) => void;
  setGradeRankingByTime: (v: boolean) => void;
  setGradeRankingPeriod: (v: GradeRankingPeriod) => void;
  setGradeRankingDeckIds: (v: string[]) => void;
  toggleStatsSection: (id: string) => void;
  setCardThemePreference: (v: CardThemeName) => void;
  setLanguagePreference: (v: LanguagePreference) => void;
  setLastHomeFilter: (v: HomeFilter) => void;
  setLastTagCardFilter: (v: HomeFilter) => void;
  setStudyTimerEnabled: (v: boolean) => void;
  setStudyTimerMinutes: (v: number) => void;
  setStudyTimerRingVisible: (v: boolean) => void;
  setStudyTimerShowTime: (v: boolean) => void;
  setStudyTimerEndBehavior: (v: StudyTimerEndBehavior) => void;
  setStudyTimerBreakMinutes: (v: number) => void;
  setStudyTimerCycles: (v: number) => void;
}

export const useSettingsStore = create<SettingsState>((set) => {
  // 汎用 setter：normalize → state 反映 → AsyncStorage 永続化 → 副作用（DEFS の定義に従う）。
  const makeSetter = <K extends keyof SettingsValues>(k: K) => (v: SettingsValues[K]) => {
    const def = DEFS[k];
    const value = def.normalize ? def.normalize(v) : v;
    set({ [k]: value } as unknown as Partial<SettingsState>);
    if (def.persist) def.persist(value);
    else AsyncStorage.setItem(def.key, String(value));
    def.onApply?.(value);
  };
  return {
    ...DEFAULTS,
    setKeyboardShortcutsEnabled: makeSetter('keyboardShortcutsEnabled'),
    setInitialFilterPreference: makeSetter('initialFilterPreference'),
    setLastSelectedCodeLanguage: makeSetter('lastSelectedCodeLanguage'),
    setLastDeckDetailFilter: makeSetter('lastDeckDetailFilter'),
    setNotificationEnabled: makeSetter('notificationEnabled'),
    // 時・分は2キーへ同時保存するため個別定義（DEFS は hydrate 用）。
    setNotificationTime: (hour, minute) => {
      set({ notificationHour: hour, notificationMinute: minute });
      AsyncStorage.setItem(DEFS.notificationHour.key, String(hour));
      AsyncStorage.setItem(DEFS.notificationMinute.key, String(minute));
    },
    setDeckSortOrder: makeSetter('deckSortOrder'),
    setDeckSortLocked: makeSetter('deckSortLocked'),
    setTagSortOrder: makeSetter('tagSortOrder'),
    setTagSortLocked: makeSetter('tagSortLocked'),
    setCardSortOrder: makeSetter('cardSortOrder'),
    setManualSortLocked: makeSetter('manualSortLocked'),
    setShuffleEnabled: makeSetter('shuffleEnabled'),
    setLastSearchField: makeSetter('lastSearchField'),
    setFsrsDesiredRetention: makeSetter('fsrsDesiredRetention'),
    setStudyHideEmpty: makeSetter('studyHideEmpty'),
    setGradeRankingByTime: makeSetter('gradeRankingByTime'),
    setGradeRankingPeriod: makeSetter('gradeRankingPeriod'),
    setGradeRankingDeckIds: makeSetter('gradeRankingDeckIds'),
    // 配列へのトグル追加/削除のため個別定義（永続化は DEFS の persist に従う）。
    toggleStatsSection: (id) => {
      set((state) => {
        const cur = state.statsCollapsedSections;
        const next = cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id];
        DEFS.statsCollapsedSections.persist?.(next);
        return { statsCollapsedSections: next };
      });
    },
    setCardThemePreference: makeSetter('cardThemePreference'),
    setLanguagePreference: makeSetter('languagePreference'),
    setLastHomeFilter: makeSetter('lastHomeFilter'),
    setLastTagCardFilter: makeSetter('lastTagCardFilter'),
    setStudyTimerEnabled: makeSetter('studyTimerEnabled'),
    setStudyTimerMinutes: makeSetter('studyTimerMinutes'),
    setStudyTimerRingVisible: makeSetter('studyTimerRingVisible'),
    setStudyTimerShowTime: makeSetter('studyTimerShowTime'),
    setStudyTimerEndBehavior: makeSetter('studyTimerEndBehavior'),
    setStudyTimerBreakMinutes: makeSetter('studyTimerBreakMinutes'),
    setStudyTimerCycles: makeSetter('studyTimerCycles'),
  };
});

/** 保存済みの1件を parse し、有効値なら update へ反映＋副作用を実行する（型を per-key に保つための generic）。 */
function hydrateOne<K extends keyof SettingsValues>(k: K, raw: string, update: Partial<SettingsValues>) {
  const def = DEFS[k];
  const parsed = def.parse(raw);
  if (parsed === undefined) return;
  update[k] = parsed;
  def.onApply?.(parsed);
}

export async function hydrateSettings(): Promise<void> {
  const raws = await Promise.all(SETTING_KEYS.map((k) => AsyncStorage.getItem(DEFS[k].key)));
  const update: Partial<SettingsValues> = {};
  SETTING_KEYS.forEach((k, i) => {
    const raw = raws[i];
    if (raw !== null) hydrateOne(k, raw, update);
  });
  if (Object.keys(update).length > 0) useSettingsStore.setState(update);
}

hydrateSettings();
