import { create } from 'zustand';

/**
 * 学習タイマー（036）の状態。セッション（学習画面）を跨いで継続させるため、
 * 画面スコープではなくアプリスコープのインメモリストアに置く。
 * AsyncStorage には永続化しない（アプリ再起動でリセット＝「セットする」行為は起動ごとの意思表示）。
 * 計時（tick）自体は学習画面マウント中のみ hooks/useStudyTimer が行う。
 *
 * phase:
 * - idle     … 未開始（タイマー無効時・アプリ起動直後）
 * - running  … 計時中（学習画面外・バックグラウンドでは hook 側が tick を止める）
 * - paused   … 手動一時停止（リングタップ）
 * - finished … 時間切れ（アラート/点滅の通知後、stop か次セッションの新規スタート待ち）
 * - stopped  … 手動終了（リング非表示）。finished/stopped は次のセッション開始で新規スタートする
 */
export type StudyTimerPhase = 'idle' | 'running' | 'paused' | 'finished' | 'stopped';

interface StudyTimerState {
  phase: StudyTimerPhase;
  remainingMs: number;
  totalMs: number;
  /** start/restart のたびに進む世代番号。計時中の restart で endAt を取り直すためのトリガー */
  epoch: number;
  start: (totalMs: number) => void;
  setRemainingMs: (v: number) => void;
  finish: () => void;
  togglePause: () => void;
  restart: () => void;
  stop: () => void;
  reset: () => void;
}

export const useStudyTimerStore = create<StudyTimerState>((set) => ({
  phase: 'idle',
  remainingMs: 0,
  totalMs: 0,
  epoch: 0,
  start: (totalMs) => set((s) => ({ phase: 'running', totalMs, remainingMs: totalMs, epoch: s.epoch + 1 })),
  setRemainingMs: (v) => set({ remainingMs: v }),
  finish: () => set({ phase: 'finished', remainingMs: 0 }),
  togglePause: () =>
    set((s) => ({ phase: s.phase === 'running' ? 'paused' : s.phase === 'paused' ? 'running' : s.phase })),
  restart: () => set((s) => ({ phase: 'running', remainingMs: s.totalMs, epoch: s.epoch + 1 })),
  stop: () => set({ phase: 'stopped' }),
  reset: () => set({ phase: 'idle', remainingMs: 0, totalMs: 0 }),
}));
