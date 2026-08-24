import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { localDateStr } from '@/lib/database/utils';

/**
 * 学習タイマー（036）＋ポモドーロ拡張（039）の状態。セッション（学習画面）を跨いで継続させるため、
 * 画面スコープではなくアプリスコープのインメモリストアに置く。
 * **同じ日のうちは AsyncStorage に永続化する**（running/paused のときだけ）。タイマーは
 * 「1日の持ち時間を隙間時間で積み上げる」使い方をされるため、アプリを閉じたり iOS に
 * プロセスを回収されたりしても today のぶんは残す。日をまたいだら畳む（`isTimerStale`）。
 * 計時（tick）自体は学習画面マウント中のみ hooks/useStudyTimer が行う
 * （例外: 休憩は壁時計ベース＝breakEndAt が唯一の真実で、画面離脱・バックグラウンド中も進む）。
 *
 * phase:
 * - idle     … 未開始（タイマー無効時・アプリ起動直後）
 * - running  … 計時中（学習画面外・バックグラウンドでは hook 側が tick を止める）
 * - paused   … 手動一時停止（リングタップ）
 * - finished … 時間切れ（アラート/点滅の通知後、stop か次セッションの新規スタート待ち）
 * - stopped  … 手動終了（リング非表示）。finished/stopped は次のセッション開始で新規スタートする
 *
 * 休憩中も phase は 'running' のまま、mode: 'study' | 'break' で区別する（039）。
 * これにより timerMounted・マウント時の継続判定・togglePause・finished の終了時動作が無改修で
 * 正しく動き、繰り返し1回（既定）では mode が 'study' から動かない＝既存挙動と同一コードパス。
 */
export type StudyTimerPhase = 'idle' | 'running' | 'paused' | 'finished' | 'stopped';

export type StudyTimerMode = 'study' | 'break';

/** ポモドーロ設定（start 時に確定コピー＝実行中の設定変更に影響されない） */
export interface StudyTimerConfig {
  cycleCount: number;
  breakMs: number;
}

interface StudyTimerState {
  phase: StudyTimerPhase;
  mode: StudyTimerMode;
  /** 現在の学習サイクル番号（1始まり）。休憩中は「直前に終えた学習」の番号のまま */
  cycleIndex: number;
  cycleCount: number;
  remainingMs: number;
  /** 現インターバル（学習 or 休憩）の長さ。リングの分母 */
  totalMs: number;
  /** 学習インターバルの長さ（休憩中は totalMs が休憩長に転用されるため別途保持） */
  studyTotalMs: number;
  breakTotalMs: number;
  /** 休憩の終了絶対時刻（壁時計ベースの唯一の真実）。休憩中以外は null */
  breakEndAt: number | null;
  /** 休憩の開始絶対時刻（統計除外用の実休憩時間の算出に使う）。休憩中以外は null */
  breakStartedAt: number | null;
  /** start/restart/インターバル遷移のたびに進む世代番号。計時 effect が endAt を取り直すトリガー */
  epoch: number;
  /** タイマーが最後に動いていた時刻（開始・インターバル遷移・計時停止のたびに更新）。
   *  日をまたいだ中断の判定（`isTimerStale`）と永続化の鮮度判定に使う。 */
  lastActiveAt: number | null;
  /** 保存済みの状態を読み終えたか。⚠️ **これを待たずにタイマーを開始してはいけない**＝
   *  学習画面のマウントが読み込みより先だと、新規スタートが復元を追い越して同日の続きが消える。 */
  hydrated: boolean;
  /** 保存の合図。`noteActive` のたびに進む。⚠️ **時刻の変化を保存の条件にしない**＝計時開始と
   *  停止が同じミリ秒だと `lastActiveAt` が動かず、その間に書き戻した残り時間が保存されない。 */
  persistSeq: number;
  start: (studyMs: number, config?: StudyTimerConfig) => void;
  setRemainingMs: (v: number) => void;
  finish: () => void;
  togglePause: () => void;
  restart: () => void;
  stop: () => void;
  reset: () => void;
  /** 計時が止まった時刻を記録する（tick の cleanup から呼ぶ）。 */
  noteActive: (now: number) => void;
  /** 学習→休憩へ遷移（phase は 'running' のまま）。now は呼び手（hook）が渡す＝ストアは純粋な set のみ */
  startBreak: (now: number) => void;
  /** 休憩→次の学習インターバルへ遷移。休憩スキップもこれを共用する */
  startNextStudy: () => void;
}

export const useStudyTimerStore = create<StudyTimerState>((set) => ({
  phase: 'idle',
  mode: 'study',
  cycleIndex: 1,
  cycleCount: 1,
  remainingMs: 0,
  totalMs: 0,
  studyTotalMs: 0,
  breakTotalMs: 0,
  breakEndAt: null,
  breakStartedAt: null,
  epoch: 0,
  lastActiveAt: null,
  hydrated: false,
  persistSeq: 0,
  start: (studyMs, config) =>
    set((s) => ({
      phase: 'running',
      mode: 'study',
      cycleIndex: 1,
      cycleCount: config?.cycleCount ?? 1,
      totalMs: studyMs,
      remainingMs: studyMs,
      studyTotalMs: studyMs,
      breakTotalMs: config?.breakMs ?? 0,
      breakEndAt: null,
      breakStartedAt: null,
      epoch: s.epoch + 1,
      lastActiveAt: Date.now(),
    })),
  setRemainingMs: (v) => set({ remainingMs: v }),
  noteActive: (now) => set((s) => ({ lastActiveAt: now, persistSeq: s.persistSeq + 1 })),
  finish: () => set({ phase: 'finished', remainingMs: 0 }),
  // 休憩中は一時停止不可（壁時計ベースと矛盾するため no-op）
  togglePause: () =>
    set((s) =>
      s.mode === 'break'
        ? s
        : { phase: s.phase === 'running' ? 'paused' : s.phase === 'paused' ? 'running' : s.phase }),
  // ポモドーロ全体の最初から（サイクル1・学習インターバル）。cycleCount=1 なら従来の restart と同一
  restart: () =>
    set((s) => ({
      phase: 'running',
      mode: 'study',
      cycleIndex: 1,
      totalMs: s.studyTotalMs,
      remainingMs: s.studyTotalMs,
      breakEndAt: null,
      breakStartedAt: null,
      epoch: s.epoch + 1,
      lastActiveAt: Date.now(),
    })),
  // stop/reset は休憩系フィールドもクリアする（グレーアウト解除条件
  // mode==='break' && phase==='running' を単純に保つため）
  stop: () => set({ phase: 'stopped', mode: 'study', breakEndAt: null, breakStartedAt: null }),
  reset: () =>
    set({
      phase: 'idle',
      mode: 'study',
      cycleIndex: 1,
      cycleCount: 1,
      remainingMs: 0,
      totalMs: 0,
      studyTotalMs: 0,
      breakTotalMs: 0,
      breakEndAt: null,
      breakStartedAt: null,
      lastActiveAt: null,
    }),
  startBreak: (now) =>
    set((s) => ({
      mode: 'break',
      totalMs: s.breakTotalMs,
      remainingMs: s.breakTotalMs,
      breakEndAt: now + s.breakTotalMs,
      breakStartedAt: now,
      epoch: s.epoch + 1,
      lastActiveAt: now,
    })),
  startNextStudy: () =>
    set((s) => ({
      mode: 'study',
      cycleIndex: s.cycleIndex + 1,
      totalMs: s.studyTotalMs,
      remainingMs: s.studyTotalMs,
      breakEndAt: null,
      breakStartedAt: null,
      epoch: s.epoch + 1,
      lastActiveAt: Date.now(),
    })),
}));

// ---------------------------------------------------------------------------
// 永続化（同じ日のうちだけ）と、日をまたいだ中断の判定
// ---------------------------------------------------------------------------

/** ⚠️ このキーは JSON エクスポートの対象に入れない（lib/settings-keys.ts）。
 *  端末ごとの一時的な進行状態であって、別端末へ持っていく意味が無いため。 */
const TIMER_STATE_KEY = '@codeflash_study_timer_state';

/** 日をまたいだ中断でも「ひと続きの学習」と見なす猶予。23:55 に閉じて 0:05 に開き直す、を救う。
 *  ⚠️ 長くしない：猶予は「昨日を今日へ延長する」働きなので、伸ばすほど**今日の最初のタイマーが
 *  昨日の残りで始まる**（1日20分の人が昨日18分使っていたら残り2分で鳴る）。 */
export const TIMER_STALE_GRACE_MS = 10 * 60_000;

type TimerSnapshot = Pick<
  StudyTimerState,
  | 'phase' | 'mode' | 'cycleIndex' | 'cycleCount' | 'remainingMs' | 'totalMs'
  | 'studyTotalMs' | 'breakTotalMs' | 'breakEndAt' | 'breakStartedAt' | 'lastActiveAt'
>;

function snapshot(s: StudyTimerState): TimerSnapshot {
  return {
    phase: s.phase, mode: s.mode, cycleIndex: s.cycleIndex, cycleCount: s.cycleCount,
    remainingMs: s.remainingMs, totalMs: s.totalMs, studyTotalMs: s.studyTotalMs,
    breakTotalMs: s.breakTotalMs, breakEndAt: s.breakEndAt, breakStartedAt: s.breakStartedAt,
    lastActiveAt: s.lastActiveAt,
  };
}

/**
 * 再開時に、このタイマーを畳んで新しく始めるべきか。
 *
 * - **日が変わっていなければ継続**＝隙間時間の積み上げ（「今日は20分」を細切れにやる使い方）
 * - 日が変わっていても、中断が `TIMER_STALE_GRACE_MS` 以内なら継続
 * - **休憩がまだ終わっていなければ継続**＝休憩は壁時計ベースで実際に進行中＝「動いている最中」
 *
 * ⚠️ 動いている最中には呼ばない（判定するのは学習画面に入るとき／フォアグラウンド復帰時だけ）。
 * 0:00 をまたいで続けて学習している最中にリセットしないため。
 */
export function isTimerStale(s: TimerSnapshot, now: number): boolean {
  if (s.phase !== 'running' && s.phase !== 'paused') return false;
  if (s.breakEndAt != null && now < s.breakEndAt) return false;
  if (s.lastActiveAt == null) return false;
  if (localDateStr(new Date(s.lastActiveAt)) === localDateStr(new Date(now))) return false;
  return now - s.lastActiveAt > TIMER_STALE_GRACE_MS;   // ちょうど10分は「10分以内」＝継続
}

// 保存は「意味のある変化」のときだけ（remainingMs は毎秒動くので購読しない）。
// 計時が止まるたびに lastActiveAt が動くので、そのタイミングで正確な残りが書き込まれる。
useStudyTimerStore.subscribe((s, prev) => {
  if (
    s.phase === prev.phase && s.mode === prev.mode &&
    s.cycleIndex === prev.cycleIndex && s.persistSeq === prev.persistSeq
  ) return;
  if (s.phase === 'running' || s.phase === 'paused') {
    AsyncStorage.setItem(TIMER_STATE_KEY, JSON.stringify(snapshot(s))).catch(() => {});
  } else {
    AsyncStorage.removeItem(TIMER_STATE_KEY).catch(() => {});
  }
});

// 起動時の復元。⚠️ **古い（日をまたいだ）スナップショットは捨てる**＝ストアが昨日の値を
// 一瞬でも持たないようにする（lib/notifications の syncBreakEndNotification など、
// 学習画面の外からストアを読む処理があるため）。
// ⚠️ すでにタイマーが動き出していたら何もしない（復元が新規スタートを上書きしないように）。
AsyncStorage.getItem(TIMER_STATE_KEY)
  .then((raw) => {
    if (!raw) return;
    const parsed = JSON.parse(raw) as TimerSnapshot;
    if (typeof parsed?.remainingMs !== 'number' || typeof parsed?.studyTotalMs !== 'number') return;
    if (parsed.phase !== 'running' && parsed.phase !== 'paused') return;
    if (isTimerStale(parsed, Date.now())) {
      AsyncStorage.removeItem(TIMER_STATE_KEY).catch(() => {});
      return;
    }
    if (useStudyTimerStore.getState().phase !== 'idle') return;
    useStudyTimerStore.setState({ ...parsed, epoch: useStudyTimerStore.getState().epoch + 1 });
  })
  .catch(() => {})
  .finally(() => useStudyTimerStore.setState({ hydrated: true }));
