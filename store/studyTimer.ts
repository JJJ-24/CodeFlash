import { create } from 'zustand';

/**
 * 学習タイマー（036）＋ポモドーロ拡張（039）の状態。セッション（学習画面）を跨いで継続させるため、
 * 画面スコープではなくアプリスコープのインメモリストアに置く。
 * AsyncStorage には永続化しない（アプリ再起動でリセット＝「セットする」行為は起動ごとの意思表示）。
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
  start: (studyMs: number, config?: StudyTimerConfig) => void;
  setRemainingMs: (v: number) => void;
  finish: () => void;
  togglePause: () => void;
  restart: () => void;
  stop: () => void;
  reset: () => void;
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
    })),
  setRemainingMs: (v) => set({ remainingMs: v }),
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
    }),
  startBreak: (now) =>
    set((s) => ({
      mode: 'break',
      totalMs: s.breakTotalMs,
      remainingMs: s.breakTotalMs,
      breakEndAt: now + s.breakTotalMs,
      breakStartedAt: now,
      epoch: s.epoch + 1,
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
    })),
}));
