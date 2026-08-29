import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { GradeRankingSortBy } from '@/lib/database/reviews';
import i18n, { resolveSystemLanguage, SUPPORTED_LANGUAGE_CODES, type SupportedLanguage } from '@/lib/i18n';
import { cancelBreakEndNotification } from '@/lib/notifications';
import { clampSpeechRate, scriptForLanguage, SPEECH_RATE_DEFAULT, type ScriptLangs, type SpeechScript, type VoiceByLang } from '@/lib/speech';
import { CARD_THEME_NAMES, type CardThemeName } from '@/lib/theme/cardThemes';
import { useStudyTimerStore } from '@/store/studyTimer';

/** ホーム画面のデッキ絞り込み。active=有効デッキのみ / all=アーカイブ含む全デッキ */
export type HomeFilter = 'active' | 'all';

/** 'system'＝端末言語に従う。言語の追加は `lib/i18n` の SUPPORTED_LANGUAGES だけを触る。 */
export type LanguagePreference = 'system' | SupportedLanguage;

function resolveLanguage(pref: LanguagePreference): string {
  return pref === 'system' ? resolveSystemLanguage() : pref;
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

// 評価率ランキング（rate モード）の足切り：期間内の総評価回数がこの値未満のカードは除外する。
// 分母極小のノイズ（1回学習で必ず 0% or 100% になる等）を防ぐ目的なので、統計的厳密さより
// 「短い期間でも空になりにくい」緩めの値。7日を 1 にしないのは分母1で率が指標として壊れるため。
export const GRADE_RANKING_RATE_MIN_TOTAL: Record<GradeRankingPeriod, number> = {
  all: 8,
  '90d': 5,
  '30d': 3,
  '7d': 2,
};

// 旧 bool 設定（by_time）からの移行つき parse（キーは据え置きで値の意味だけ拡張）。
// 旧 true（平均時間）→'time' / 旧 false（評価回数）→'count'
const parseGradeRankingSortBy = (raw: string): GradeRankingSortBy | undefined => {
  if (raw === 'count' || raw === 'time' || raw === 'rate') return raw;
  if (raw === 'true') return 'time';
  if (raw === 'false') return 'count';
  return undefined;
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

/**
 * 学習タイマーの終了時動作。
 * - 'alert' : バイブ＋モーダル（［再開］／［完了］）＝既定。時間切れは「やめるか続けるか」を
 *             決める区切りなので、手を止めさせること自体が機能
 * - 'blink' : リング点滅のみ（タップで停止）
 * - 'none'  : 何も出さない（バイブも無し）。**満円だけは静止したまま淡く残る**
 *             （円/残り時間をどちらも「なし」にしていると時間切れの合図が画面から完全に
 *              消えるため。淡くするのは走行中の満円＝開始直後と見分けるため）
 *
 * 046 の「達成時の動作」と違い 'none' でも触覚を鳴らさない＝'blink' がすでに無音なので、
 * 'none' だけ震えると「点滅より『なし』の方がうるさい」逆転が起きる。
 */
export type StudyTimerEndBehavior = 'alert' | 'blink' | 'none';

/**
 * 046: 1日の目標を達成したときの知らせ方。
 * - 'alert' : モーダル（［続ける］／［学習を完了］）。手を止めてタップが要る
 * - 'pill'  : 数秒で消えるピル通知（タップ不要）＝既定
 * - 'none'  : 何も出さない（触覚だけ。進捗バッジと完了画面には出る）
 *
 * 触覚（Haptics.Success）は3択のどれでも鳴らす＝最も静かな知らせで、'none' は
 * 「画面を止めない」の意であって「無反応」ではない。
 */
export type StudyGoalReachedBehavior = 'alert' | 'pill' | 'none';

/**
 * 統計「学習の記録」シートの数値ブロックの表示モード（Σ／最高／平均）。
 * 回数・時間・日数・目標の4軸すべてに同時に効く。
 */
export type RecordSheetMode = 'total' | 'max' | 'avg';

/**
 * 学習タイマーの表示要素（円・残り時間）の表示モード。
 * - 'on'    : 常に表示
 * - 'start' : 開始時（＋タップ時のピーク）に数秒だけ表示→フェードアウト
 * - 'off'   : 一切表示しない
 * タップのピークは「'start' に設定された要素だけ」を再表示する（円が 'on'＝常時表示のときは
 * タップ＝一時停止で、ピークはしない）。両方 'off' はピークなし（枠線＋開始ヒントのみ）。
 */
export type StudyTimerElementMode = 'on' | 'start' | 'off';
export const STUDY_TIMER_ELEMENT_MODES = ['on', 'start', 'off'] as const;

// 旧 bool 設定からの移行つき parse（キーは据え置きで値の意味だけ拡張）。
//  円   : 旧 true（常時表示）→'on' / 旧 false（＝当時の「OFF」＝開始時のみ表示＋ゴースト＋ピーク）→'start'
//  残時間: 旧 true→'on' / 旧 false→'off'
// ※旧「円OFF＋残時間ON」（＝ミニマル数字時計・円は一切出ない）だけは 'start'+'on' に移行して
//   開始時に円が一瞬出るようになるが、該当する組み合わせは稀なため許容（既定 on/off と
//   「円OFF＋残時間OFF」のピーク挙動は正確に保たれる）。
const parseStudyTimerRing = (raw: string): StudyTimerElementMode | undefined => {
  if ((STUDY_TIMER_ELEMENT_MODES as readonly string[]).includes(raw)) return raw as StudyTimerElementMode;
  if (raw === 'true') return 'on';
  if (raw === 'false') return 'start';
  return undefined;
};
const parseStudyTimerTime = (raw: string): StudyTimerElementMode | undefined => {
  if ((STUDY_TIMER_ELEMENT_MODES as readonly string[]).includes(raw)) return raw as StudyTimerElementMode;
  if (raw === 'true') return 'on';
  if (raw === 'false') return 'off';
  return undefined;
};

export const STUDY_TIMER_MINUTES_MIN = 1;
export const STUDY_TIMER_MINUTES_MAX = 60;
export const STUDY_TIMER_MINUTES_DEFAULT = 10;

const clampTimerMinutes = (v: number) =>
  Math.max(STUDY_TIMER_MINUTES_MIN, Math.min(STUDY_TIMER_MINUTES_MAX, Math.round(v)));

// ポモドーロ拡張（039）: 休憩時間と繰り返し回数。回数1（既定）＝従来の単発タイマーと同一挙動。
// 0分＝休憩なし（休憩モードに入らず次の学習インターバルへ直行＝連続セット）。
export const STUDY_TIMER_BREAK_MINUTES_MIN = 0;
export const STUDY_TIMER_BREAK_MINUTES_MAX = 30;
export const STUDY_TIMER_BREAK_MINUTES_DEFAULT = 5;

const clampBreakMinutes = (v: number) =>
  Math.max(STUDY_TIMER_BREAK_MINUTES_MIN, Math.min(STUDY_TIMER_BREAK_MINUTES_MAX, Math.round(v)));

export const STUDY_TIMER_CYCLES_MIN = 1;
export const STUDY_TIMER_CYCLES_MAX = 12;
export const STUDY_TIMER_CYCLES_DEFAULT = 1;

const clampTimerCycles = (v: number) =>
  Math.max(STUDY_TIMER_CYCLES_MIN, Math.min(STUDY_TIMER_CYCLES_MAX, Math.round(v)));

// 046: 1日の目標枚数。タイマー（時間で区切る）に対して「量で区切る」ための目標。
// **1日単位**（セッション単位ではない）＝Phase 2 の未達成リマインダーと同じ目標を共有するため。
export const STUDY_GOAL_COUNT_MIN = 1;
export const STUDY_GOAL_COUNT_MAX = 999;
export const STUDY_GOAL_COUNT_DEFAULT = 20;
// スライダーが覆う実用域。設定値としては 999 まで保持できるが、スライダーで 999 まで引くと
// 1目盛りが粗くなって狙った枚数に合わせられないため、UI 側だけ 100 で頭打ちにする。
export const STUDY_GOAL_SLIDER_MAX = 100;

const clampGoalCount = (v: number) =>
  Math.max(STUDY_GOAL_COUNT_MIN, Math.min(STUDY_GOAL_COUNT_MAX, Math.round(v)));

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
  gradeRankingSortBy: GradeRankingSortBy;
  gradeRankingPeriod: GradeRankingPeriod;
  gradeRankingDeckIds: string[];
  // 統計タブで折りたたみ中のセクションID（'chart'|'heatmap'|'today'|'total'|'mastery'|'pro'）
  statsCollapsedSections: string[];
  // 統計「学習の記録」シートの表示モード（Σ／最高／平均）
  recordSheetMode: RecordSheetMode;
  // 学習設定で折りたたみ中のセクションID（'goal'|'speech'|'fsrs'|'timer'）
  studyCollapsedSections: string[];
  cardThemePreference: CardThemeName;
  languagePreference: LanguagePreference;
  lastHomeFilter: HomeFilter;
  lastTagCardFilter: HomeFilter;
  studyTimerEnabled: boolean;
  studyTimerMinutes: number;
  studyTimerRing: StudyTimerElementMode;
  studyTimerTime: StudyTimerElementMode;
  studyTimerEndBehavior: StudyTimerEndBehavior;
  studyTimerBreakMinutes: number;
  studyTimerCycles: number;
  // 046: 1日の目標枚数（量で区切る学習）。OFF のときは達成アラートも未達成判定も動かない
  studyGoalEnabled: boolean;
  studyGoalCount: number;
  studyGoalReachedBehavior: StudyGoalReachedBehavior;
  // 049: カード本文の読み上げ（TTS）
  speechEnabled: boolean;
  speechRate: number;
  /**
   * 文字体系ごとの読み上げ言語の**上書き**（BCP-47）。空なら全部 `SCRIPT_DEFAULT_LANGS`。
   * ⚠️ 既定値は端末言語から作るものがある（漢字）ので、**上書きだけを保存する**（全部保存しない）。
   */
  speechScriptLangs: ScriptLangs;
  /**
   * 言語ごとに使う声（BCP-47 → identifier）。空なら端末の既定の声に任せる。
   * ⚠️ **文字体系ではなく言語で持つ**（区間は言語で畳まれるため）。
   * ⚠️ identifier は端末固有なので、使う前に `filterKnownVoices` で実在確認する。
   */
  speechVoices: VoiceByLang;
  /**
   * 日本語と混ざるときはラテン文字も同じ声で読む（＝混在文で声を分けない）。
   * ⚠️ **英語だけのカードには効かせない**（`resolveSpeechSegments` が判定）＝常に倒すと
   * 「英語の技術用語の発音を聞く」という本命の使い道が失われるため。
   */
  speechNoMixedSwitch: boolean;
  // 学習の記録バッジ：周回の段階開放（分母 50→80→110）の既読段階。案内メッセージを一度だけ出すために保存
  badgeLapStageSeen: number;
}

/**
 * 設定1件分の永続化定義。
 * - `key`: AsyncStorage キー。**変更するとユーザーの既存設定が読めなくなるため厳守**
 *   （エクスポート対象キーは lib/settings-keys.ts が別途参照する）。
 * - `parse`: 保存文字列 → 値。`undefined` を返すと無効値として無視（既定値のまま）。
 * - `normalize`: setter での正規化（clamp 等）。
 * - `persist`: 既定の `AsyncStorage.setItem(key, String(v))` を差し替える（配列の JSON 化等）。
 * - `onApply`: setter 適用時・hydrate 成功時の副作用（言語切替等）。第2引数 `hydrating` は
 *   起動時の読み込み由来かどうか。**ユーザー操作のときだけ効かせたい副作用はこれで弾く**。
 */
interface SettingDef<T> {
  key: string;
  default: T;
  parse: (raw: string) => T | undefined;
  normalize?: (v: T) => T;
  persist?: (v: T) => void;
  onApply?: (v: T, hydrating?: boolean) => void;
}

const asIs = (raw: string) => raw;
const asBool = (raw: string) => raw === 'true';
const asNum = (raw: string) => Number(raw);
const oneOf = <T extends string>(values: readonly T[]) => (raw: string): T | undefined =>
  (values as readonly string[]).includes(raw) ? (raw as T) : undefined;

const GRADE_RANKING_DECK_IDS_KEY = '@codeflash_grade_ranking_deck_ids';
const STATS_COLLAPSED_SECTIONS_KEY = '@codeflash_stats_collapsed_sections';
const STUDY_COLLAPSED_SECTIONS_KEY = '@codeflash_study_collapsed_sections';
const SPEECH_SCRIPT_LANGS_KEY = '@codeflash_speech_script_langs';
const SPEECH_VOICES_KEY = '@codeflash_speech_voices';
// 049 の旧キー（ラテン／非ラテンの2つだけだった時代）。050 のマップへ一度だけ移行する。
const LEGACY_SPEECH_LATIN_KEY = '@codeflash_speech_latin_lang';
const LEGACY_SPEECH_NON_LATIN_KEY = '@codeflash_speech_non_latin_lang';

// 作動中（一時停止含む）にタイマー設定（分数/休憩/回数）を変更したら計り直す（旧い残り時間の
// ままだと設定が効いていないように見えるため）。次の学習開始時に新しい設定でスタートする。
// 休憩中だった場合は予約済みの休憩終了通知も掃除する（039・休憩開始時予約方式）。
// ⚠️ **hydrate 由来では絶対に走らせない**（`hydrating` で弾く）。タイマーは同じ日のうち
// 保存から復元されるようになったため、起動時に「未開始だから無害」という前提が成り立たない。
// 弾かないと、復元したタイマーを設定の読み込みが毎回消す（実際にそうなった）。
const resetStudyTimerIfActive = (_v?: unknown, hydrating?: boolean) => {
  if (hydrating) return;
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
  gradeRankingSortBy: { key: '@codeflash_grade_ranking_by_time', default: 'count', parse: parseGradeRankingSortBy },
  // 「学習の記録」の表示モード。**シートを開くたびにリセットしない**＝一覧のソートやフィルターと
  // 同じで直近の選択を覚える（4軸すべてに効くので「平均で見たい」等の好みが固定されうる）。
  // 誤読の心配が小さいのは、モードを変えると数字だけでなくラベルも変わるため。
  recordSheetMode: { key: '@codeflash_record_sheet_mode', default: 'total', parse: oneOf(['total', 'max', 'avg'] as const) },
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
  studyCollapsedSections: {
    key: STUDY_COLLAPSED_SECTIONS_KEY,
    default: [],
    parse: (r) => {
      try {
        const parsed = JSON.parse(r);
        return Array.isArray(parsed) ? parsed : undefined;
      } catch { return undefined; }
    },
    // 空配列（=すべて展開）はキー自体を消す。
    persist: (v) => {
      if (v.length === 0) AsyncStorage.removeItem(STUDY_COLLAPSED_SECTIONS_KEY);
      else AsyncStorage.setItem(STUDY_COLLAPSED_SECTIONS_KEY, JSON.stringify(v));
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
    parse: oneOf<LanguagePreference>(['system', ...SUPPORTED_LANGUAGE_CODES]),
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
    onApply: (v, hydrating) => { if (!v) resetStudyTimerIfActive(v, hydrating); },
  },
  studyTimerMinutes: {
    key: '@codeflash_study_timer_minutes',
    default: STUDY_TIMER_MINUTES_DEFAULT,
    parse: (r) => { const v = Number(r); return Number.isNaN(v) ? undefined : clampTimerMinutes(v); },
    normalize: clampTimerMinutes,
    onApply: resetStudyTimerIfActive,
  },
  studyTimerRing: { key: '@codeflash_study_timer_ring_visible', default: 'on', parse: parseStudyTimerRing },
  studyTimerTime: { key: '@codeflash_study_timer_show_time', default: 'off', parse: parseStudyTimerTime },
  studyTimerEndBehavior: { key: '@codeflash_study_timer_end_behavior', default: 'alert', parse: oneOf(['alert', 'blink', 'none'] as const) },
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
  // 046: 目標を変えると未達成リマインダーの予約内容も変わる（OFF なら予約自体を止める）。
  // 予約の積み直しは DB が要るので画面側（設定→通知・学習セッション・フォアグラウンド復帰）が行う。
  studyGoalEnabled: { key: '@codeflash_study_goal_enabled', default: false, parse: asBool },
  studyGoalCount: {
    key: '@codeflash_study_goal_count',
    default: STUDY_GOAL_COUNT_DEFAULT,
    parse: (r) => { const v = Number(r); return Number.isNaN(v) ? undefined : clampGoalCount(v); },
    normalize: clampGoalCount,
  },
  // 既定は 'pill'（アラートではない）。目標は上限ではなく目安なので、達成のたびに
  // ［続ける／完了］の選択を迫る必然性が無い。完了への導線はヘッダーの ✓ と Q キーにある。
  studyGoalReachedBehavior: {
    key: '@codeflash_study_goal_reached_behavior',
    default: 'pill',
    parse: oneOf(['alert', 'pill', 'none'] as const),
  },
  // 049: 読み上げ。OFF は学習画面の読み上げボタンと S キーを出さない（機能ごと畳む）。
  speechEnabled: { key: '@codeflash_speech_enabled', default: true, parse: asBool },
  speechRate: {
    key: '@codeflash_speech_rate',
    default: SPEECH_RATE_DEFAULT,
    // ⚠️ **固定の選択肢ではなく範囲で受ける**（かつては4値のみ許可）＝スライダーで
    // 任意の値を選べるようにしたため。範囲外・数値でない値は既定へ落とす。
    parse: (r) => { const v = Number(r); return r.trim() !== '' && Number.isFinite(v) ? clampSpeechRate(v) : undefined; },
  },
  // BCP-47 は端末の音声一覧から選ぶので、ここでは値の妥当性を検査しない
  // （端末に無い言語が入っていても iOS 側が既定の声にフォールバックする）。
  speechScriptLangs: {
    key: SPEECH_SCRIPT_LANGS_KEY,
    default: {},
    parse: (r) => {
      try {
        const parsed = JSON.parse(r);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
      } catch { return undefined; }
    },
    // 上書きが空（＝すべて既定）ならキー自体を消す。
    persist: (v) => {
      if (Object.keys(v).length === 0) AsyncStorage.removeItem(SPEECH_SCRIPT_LANGS_KEY);
      else AsyncStorage.setItem(SPEECH_SCRIPT_LANGS_KEY, JSON.stringify(v));
    },
  },
  speechNoMixedSwitch: { key: '@codeflash_speech_no_mixed_switch', default: false, parse: asBool },
  speechVoices: {
    key: SPEECH_VOICES_KEY,
    default: {},
    parse: (r) => {
      try {
        const parsed = JSON.parse(r);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
      } catch { return undefined; }
    },
    // 1つも選んでいなければキー自体を消す。
    persist: (v) => {
      if (Object.keys(v).length === 0) AsyncStorage.removeItem(SPEECH_VOICES_KEY);
      else AsyncStorage.setItem(SPEECH_VOICES_KEY, JSON.stringify(v));
    },
  },
  badgeLapStageSeen: {
    key: '@codeflash_badge_lap_stage_seen',
    default: 1,
    parse: (r) => { const v = Number(r); return v === 1 || v === 2 || v === 3 ? v : undefined; },
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
  setGradeRankingSortBy: (v: GradeRankingSortBy) => void;
  setRecordSheetMode: (v: RecordSheetMode) => void;
  setGradeRankingPeriod: (v: GradeRankingPeriod) => void;
  setGradeRankingDeckIds: (v: string[]) => void;
  toggleStatsSection: (id: string) => void;
  toggleStudySection: (id: string) => void;
  setCardThemePreference: (v: CardThemeName) => void;
  setLanguagePreference: (v: LanguagePreference) => void;
  setLastHomeFilter: (v: HomeFilter) => void;
  setLastTagCardFilter: (v: HomeFilter) => void;
  setStudyTimerEnabled: (v: boolean) => void;
  setStudyTimerMinutes: (v: number) => void;
  setStudyTimerRing: (v: StudyTimerElementMode) => void;
  setStudyTimerTime: (v: StudyTimerElementMode) => void;
  setStudyTimerEndBehavior: (v: StudyTimerEndBehavior) => void;
  setStudyTimerBreakMinutes: (v: number) => void;
  setStudyTimerCycles: (v: number) => void;
  setStudyGoalEnabled: (v: boolean) => void;
  setStudyGoalCount: (v: number) => void;
  setStudyGoalReachedBehavior: (v: StudyGoalReachedBehavior) => void;
  setSpeechEnabled: (v: boolean) => void;
  setSpeechRate: (v: number) => void;
  /** 文字体系1つぶんの言語を上書きする（他の文字体系はそのまま） */
  setSpeechScriptLang: (script: SpeechScript, lang: string) => void;
  setSpeechNoMixedSwitch: (v: boolean) => void;
  /** 言語1つぶんの声を選ぶ。`null` で「自動」（端末の既定に任せる）へ戻す */
  setSpeechVoice: (language: string, identifier: string | null) => void;
  setBadgeLapStageSeen: (v: number) => void;
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
    setGradeRankingSortBy: makeSetter('gradeRankingSortBy'),
    setRecordSheetMode: makeSetter('recordSheetMode'),
    setGradeRankingPeriod: makeSetter('gradeRankingPeriod'),
    setGradeRankingDeckIds: makeSetter('gradeRankingDeckIds'),
    // 配列へのトグル追加/削除のため個別定義（永続化は DEFS の persist に従う）。
    toggleStudySection: (id) => {
      set((state) => {
        const cur = state.studyCollapsedSections;
        const next = cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id];
        DEFS.studyCollapsedSections.persist?.(next);
        return { studyCollapsedSections: next };
      });
    },
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
    setStudyTimerRing: makeSetter('studyTimerRing'),
    setStudyTimerTime: makeSetter('studyTimerTime'),
    setStudyTimerEndBehavior: makeSetter('studyTimerEndBehavior'),
    setStudyTimerBreakMinutes: makeSetter('studyTimerBreakMinutes'),
    setStudyTimerCycles: makeSetter('studyTimerCycles'),
    setStudyGoalEnabled: makeSetter('studyGoalEnabled'),
    setStudyGoalCount: makeSetter('studyGoalCount'),
    setStudyGoalReachedBehavior: makeSetter('studyGoalReachedBehavior'),
    setSpeechEnabled: makeSetter('speechEnabled'),
    setSpeechRate: makeSetter('speechRate'),
    // マップの1エントリだけ差し替えるため個別定義（永続化は DEFS の persist に従う）。
    // ⚠️ **選んだ値はそのまま保存する**（既定と同じでも捨てない）。かつて「既定と同じなら
    // 保存しない」にしたが、既定は `SCRIPT_DEFAULT_LANGS` の固定タグで、端末が実際に持って
    // いる音声（例：`ar-SA` ではなく `ar-001`）と一致するとは限らないため当てにならない。
    // 設定画面の行の出し分けは**端末の音声一覧だけ**で判断する（保存内容と結びつけない）。
    setSpeechScriptLang: (script, lang) => {
      set((state) => {
        const next = { ...state.speechScriptLangs, [script]: lang };
        DEFS.speechScriptLangs.persist?.(next);
        return { speechScriptLangs: next };
      });
    },
    setSpeechNoMixedSwitch: makeSetter('speechNoMixedSwitch'),
    // 「自動」（null）は言語ごと消す＝声を選び直せる状態に戻す。
    setSpeechVoice: (language, identifier) => {
      set((state) => {
        const next = { ...state.speechVoices };
        if (identifier) next[language] = identifier;
        else delete next[language];
        DEFS.speechVoices.persist?.(next);
        return { speechVoices: next };
      });
    },
    setBadgeLapStageSeen: makeSetter('badgeLapStageSeen'),
  };
});

/** 保存済みの1件を parse し、有効値なら update へ反映＋副作用を実行する（型を per-key に保つための generic）。 */
function hydrateOne<K extends keyof SettingsValues>(k: K, raw: string, update: Partial<SettingsValues>) {
  const def = DEFS[k];
  const parsed = def.parse(raw);
  if (parsed === undefined) return;
  update[k] = parsed;
  def.onApply?.(parsed, true);
}

/**
 * 049（ラテン／非ラテンの2キー）→ 050（文字体系ごとのマップ）へ一度だけ移行する。
 *
 * 旧「非ラテンの言語」は**その言語が使う文字体系の上書き**へ移す（`ja`/`zh` → 漢字、
 * `ru` → キリル…）。既定と同じ値になることもあるが、書いても害はない。
 * ⚠️ 新キーが既にあるときは何もしない（移行後にユーザーが変えた設定を旧値で潰さないため）。
 */
async function migrateLegacySpeechLangs(): Promise<ScriptLangs | undefined> {
  const [latin, nonLatin] = await Promise.all([
    AsyncStorage.getItem(LEGACY_SPEECH_LATIN_KEY),
    AsyncStorage.getItem(LEGACY_SPEECH_NON_LATIN_KEY),
  ]);
  const langs: ScriptLangs = {};
  if (latin) langs.latin = latin;
  if (nonLatin) {
    const script = scriptForLanguage(nonLatin);
    if (script) langs[script] = nonLatin;
  }
  if (Object.keys(langs).length === 0) return undefined;
  DEFS.speechScriptLangs.persist?.(langs);
  return langs;
}

export async function hydrateSettings(): Promise<void> {
  const raws = await Promise.all(SETTING_KEYS.map((k) => AsyncStorage.getItem(DEFS[k].key)));
  const update: Partial<SettingsValues> = {};
  SETTING_KEYS.forEach((k, i) => {
    const raw = raws[i];
    if (raw !== null) hydrateOne(k, raw, update);
  });
  // 旧「なし」（言語に 'none' を選ぶ方式）からの移行。言語は既定へ戻し、トグルを ON にする。
  // ⚠️ 「なし」は英語だけのカードまで日本語の声にしてしまうため、混在文限定のトグルへ置き換えた。
  if (update.speechScriptLangs?.latin === 'none') {
    const { latin: _dropped, ...rest } = update.speechScriptLangs;
    update.speechScriptLangs = rest;
    update.speechNoMixedSwitch = true;
    DEFS.speechScriptLangs.persist?.(rest);
    AsyncStorage.setItem(DEFS.speechNoMixedSwitch.key, 'true');
  }
  if (update.speechScriptLangs === undefined) {
    const migrated = await migrateLegacySpeechLangs();
    if (migrated) update.speechScriptLangs = migrated;
  }
  if (Object.keys(update).length > 0) useSettingsStore.setState(update);
}

hydrateSettings();
