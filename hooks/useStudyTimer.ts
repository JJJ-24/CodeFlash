import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useStudyTimerStore } from '@/store/studyTimer';

interface UseStudyTimerOptions {
  /** isPro && studyTimerEnabled。false ならタイマーを開始しない（既存状態もクリアする） */
  enabled: boolean;
  /** 設定分数（1〜60）。新規スタート時のみ反映（継続中の変更は次の新規スタートから） */
  minutes: number;
  /** 画面フォーカス喪失（編集モーダル・完了画面等）の間 true → 自動一時停止（phase は変えない＝手動 pause と区別） */
  suspended: boolean;
  onFinish: () => void;
}

const TICK_MS = 250;

/**
 * 学習タイマー（036）の計時担当。状態は store/studyTimer（アプリスコープ・インメモリ）にあり、
 * セッションを跨いで継続する。このフックは学習画面マウント中のみ tick を回す。
 * - セッション開始時: 継続中（running/paused）なら引き継ぎ、未開始/終了後なら設定分数で新規スタート
 * - 絶対時刻ベース（endAt = now + remainingMs）で計時し、TICK_MS ごとに差分を再計算
 * - 一時停止は2系統: 手動（togglePause＝phase 切替）と自動（suspended prop・AppState background）
 */
export function useStudyTimer({ enabled, minutes, suspended, onFinish }: UseStudyTimerOptions) {
  const { phase, remainingMs, totalMs, epoch, togglePause, restart, stop } = useStudyTimerStore();
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  // セッション開始（マウント）時の継続/新規スタート判定。1回だけ実行する。
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const store = useStudyTimerStore.getState();
    if (!enabled) {
      // 途中でタイマー設定を OFF にした場合の残骸をクリア
      if (store.phase !== 'idle') store.reset();
      return;
    }
    if (store.phase === 'idle' || store.phase === 'finished' || store.phase === 'stopped') {
      store.start(minutes * 60_000);
    }
    // running/paused はそのまま継続（デッキ跨ぎ・同デッキやり直しで続きから動く）
  }, [enabled, minutes]);

  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const counting = enabled && phase === 'running' && !suspended && appActive;

  useEffect(() => {
    if (!counting) return;
    const store = useStudyTimerStore.getState();
    const epochAtStart = store.epoch;
    const endAt = Date.now() + store.remainingMs;
    const id = setInterval(() => {
      const rem = endAt - Date.now();
      const st = useStudyTimerStore.getState();
      if (rem <= 0) {
        st.finish();
        onFinishRef.current();
      } else if (Math.ceil(rem / 1000) !== Math.ceil(st.remainingMs / 1000)) {
        // 表示は秒粒度で十分なので、秒が変わったときだけ書き込む（毎 tick の再レンダーを抑制）
        st.setRemainingMs(rem);
      }
    }, TICK_MS);
    return () => {
      clearInterval(id);
      // 中断時点の正確な残りを書き戻す（秒粒度書込のズレを解消）。
      // restart 直後（epoch が進んだ後）は新しい残り時間を上書きしないようスキップ。
      const st = useStudyTimerStore.getState();
      if (st.epoch === epochAtStart && st.phase !== 'finished') {
        st.setRemainingMs(Math.max(0, endAt - Date.now()));
      }
    };
  }, [counting, epoch]);

  return { phase, remainingMs, totalMs, counting, epoch, togglePause, restart, stop };
}
