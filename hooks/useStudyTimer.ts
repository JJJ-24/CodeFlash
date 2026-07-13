import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { cancelBreakEndNotification, scheduleBreakEndNotification } from '@/lib/notifications';
import { useStudyTimerStore } from '@/store/studyTimer';

interface UseStudyTimerOptions {
  /** isPro && studyTimerEnabled。false ならタイマーを開始しない（既存状態もクリアする） */
  enabled: boolean;
  /** 設定分数（1〜60）。新規スタート時のみ反映（継続中の変更は次の新規スタートから） */
  minutes: number;
  /** 休憩時間（1〜30分・039）。新規スタート時に確定コピー */
  breakMinutes: number;
  /** 繰り返し回数（1〜12・039）。1 なら休憩コードパスに一切入らない＝従来の単発タイマー */
  cycles: number;
  /** 画面フォーカス喪失（編集モーダル・完了画面等）の間 true → 自動一時停止（phase は変えない＝手動 pause と区別） */
  suspended: boolean;
  onFinish: () => void;
  /** 学習→休憩の自動遷移時（UX＝ハプティクス用） */
  onBreakStart?: () => void;
  /** 休憩→次の学習への遷移時（自然終了/スキップ。stop では呼ばれない） */
  onBreakEnd?: () => void;
  /** 休憩の実経過時間（ms）。全離脱経路（自然終了/スキップ/停止）で呼ばれる＝統計除外用 */
  onBreakElapsed?: (deltaMs: number) => void;
}

const TICK_MS = 250;

/**
 * 学習タイマー（036）＋ポモドーロ（039）の計時担当。状態は store/studyTimer
 * （アプリスコープ・インメモリ）にあり、セッションを跨いで継続する。
 * - セッション開始時: 継続中（running/paused）なら引き継ぎ、未開始/終了後なら設定分数で新規スタート
 * - 学習: 絶対時刻ベース（endAt = now + remainingMs）で計時し、TICK_MS ごとに差分を再計算。
 *   フォーカス中＋フォアグラウンドのみ進む（suspended・AppState で自動一時停止）
 * - 休憩: 壁時計ベース（breakEndAt が唯一の真実）。suspended・バックグラウンドに関係なく進み、
 *   JS が止まっていた分は復帰時に resolveBreak() が解決する
 * - 一時停止は2系統: 手動（togglePause＝phase 切替・休憩中は no-op）と自動（suspended prop・AppState）
 */
export function useStudyTimer({
  enabled,
  minutes,
  breakMinutes,
  cycles,
  suspended,
  onFinish,
  onBreakStart,
  onBreakEnd,
  onBreakElapsed,
}: UseStudyTimerOptions) {
  const { phase, mode, cycleIndex, cycleCount, remainingMs, totalMs, breakEndAt, epoch, togglePause, restart } =
    useStudyTimerStore();
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const breakCallbacksRef = useRef({ onBreakStart, onBreakEnd, onBreakElapsed });
  breakCallbacksRef.current = { onBreakStart, onBreakEnd, onBreakElapsed };

  // 休憩からの離脱を一元化: 実休憩時間を統計除外へ通知 → stop なら停止／それ以外は次の学習へ。
  // mode ガードで二重解決（AppState リスナーと tick effect の競合等）を防ぐ。
  const endBreak = useCallback((reason: 'natural' | 'skip' | 'stop') => {
    const st = useStudyTimerStore.getState();
    if (st.mode !== 'break') return;
    const now = Date.now();
    const delta = Math.max(0, now - (st.breakStartedAt ?? now));
    breakCallbacksRef.current.onBreakElapsed?.(delta);
    if (reason === 'stop') {
      st.stop();
    } else {
      st.startNextStudy();
      breakCallbacksRef.current.onBreakEnd?.();
    }
    cancelBreakEndNotification();
  }, []);

  // 復帰時解決: JS 停止中（バックグラウンド・デッキ切替）に休憩が終わっていたら即遷移する。
  // バックグラウンド中に学習は進まない設計なので、飛び越すべき遷移は最大1つ（多段解決ループ不要）。
  const resolveBreak = useCallback(() => {
    const st = useStudyTimerStore.getState();
    if (st.mode === 'break' && st.phase === 'running' && st.breakEndAt != null && Date.now() >= st.breakEndAt) {
      endBreak('natural');
    }
  }, [endBreak]);

  // セッション開始（マウント）時の継続/新規スタート判定。1回だけ実行する。
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const store = useStudyTimerStore.getState();
    if (!enabled) {
      // 途中でタイマー設定を OFF にした場合の残骸をクリア（休憩中だった場合は予約済み通知も掃除）
      if (store.phase !== 'idle') {
        store.reset();
        cancelBreakEndNotification();
      }
      return;
    }
    if (store.phase === 'idle' || store.phase === 'finished' || store.phase === 'stopped') {
      store.start(minutes * 60_000, { cycleCount: cycles, breakMs: breakMinutes * 60_000 });
    }
    // running/paused はそのまま継続（デッキ跨ぎ・同デッキやり直しで続きから動く）。
    // デッキ切替中（アンマウント中）に休憩が終わっていたケースはここで解決する。
    resolveBreak();
  }, [enabled, minutes, breakMinutes, cycles, resolveBreak]);

  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setAppActive(s === 'active');
      // 休憩終了通知は休憩開始時に予約済み（学習画面の外・バックグラウンドを問わず届く）。
      // _layout の active 復帰時 cancel-all（リマインダー再登録）に巻き込まれて消える分は
      // _layout 側の syncBreakEndNotification() が予約し直す（この hook では触らない）。
      if (s === 'active') {
        // バックグラウンド中に休憩が終わっていたら即遷移
        resolveBreak();
      }
    });
    return () => sub.remove();
  }, [resolveBreak]);

  // リングアニメ駆動。学習はフォーカス中＋フォアグラウンドのみ、休憩は suspended を無視
  // （壁時計＝編集モーダル上・完了画面でも進むため、アニメも追従させる）。
  const counting = enabled && phase === 'running' && appActive && (mode === 'break' || !suspended);

  // 学習 tick: フォーカス中＋フォアグラウンドのみ進む（書き戻し方式）。
  // 学習インターバルの時間切れは必ず画面上で起こるため、学習→休憩の遷移検出はここだけで十分。
  const studyCounting = counting && mode === 'study';
  useEffect(() => {
    if (!studyCounting) return;
    const store = useStudyTimerStore.getState();
    const epochAtStart = store.epoch;
    const endAt = Date.now() + store.remainingMs;
    const id = setInterval(() => {
      const rem = endAt - Date.now();
      const st = useStudyTimerStore.getState();
      if (rem <= 0) {
        if (st.cycleIndex >= st.cycleCount) {
          // 最終インターバル終了＝ポモドーロ完了（cycleCount=1 なら従来の時間切れと同一）
          st.finish();
          onFinishRef.current();
        } else {
          // 中間インターバル終了→休憩へ自動移行（epoch が進むためこの effect は再起動され、
          // studyCounting=false で tick は止まる）。休憩終了通知はこの時点で予約する
          // （画面離脱・バックグラウンドを問わず届く。フォアグラウンド表示の可否は
          // lib/notifications の setNotificationHandler が判定）。
          st.startBreak(Date.now());
          const after = useStudyTimerStore.getState();
          if (after.breakEndAt != null) scheduleBreakEndNotification(after.breakEndAt).catch(() => {});
          breakCallbacksRef.current.onBreakStart?.();
        }
      } else if (Math.ceil(rem / 1000) !== Math.ceil(st.remainingMs / 1000)) {
        // 表示は秒粒度で十分なので、秒が変わったときだけ書き込む（毎 tick の再レンダーを抑制）
        st.setRemainingMs(rem);
      }
    }, TICK_MS);
    return () => {
      clearInterval(id);
      // 中断時点の正確な残りを書き戻す（秒粒度書込のズレを解消）。
      // restart/startBreak 直後（epoch が進んだ後）は新しい残り時間を上書きしないようスキップ。
      const st = useStudyTimerStore.getState();
      if (st.epoch === epochAtStart && st.phase !== 'finished') {
        st.setRemainingMs(Math.max(0, endAt - Date.now()));
      }
    };
  }, [studyCounting, epoch]);

  // 休憩 tick: 壁時計ベース。suspended・appActive を条件に含めない（編集モーダル上・完了画面でも進む。
  // バックグラウンドでは JS ごと止まるが、復帰時に resolveBreak が breakEndAt から解決する）。
  // cleanup の書き戻しは不要（breakEndAt が真実・remainingMs は表示キャッシュ）。
  const breakTicking = enabled && phase === 'running' && mode === 'break';
  useEffect(() => {
    if (!breakTicking) return;
    // 冒頭で即時解決（終了済みの休憩に 250ms の遅延を挟まない）。解決したら interval は不要
    resolveBreak();
    if (useStudyTimerStore.getState().mode !== 'break') return;
    const id = setInterval(() => {
      const st = useStudyTimerStore.getState();
      if (st.breakEndAt == null) return;
      const rem = st.breakEndAt - Date.now();
      if (rem <= 0) {
        endBreak('natural');
      } else if (Math.ceil(rem / 1000) !== Math.ceil(st.remainingMs / 1000)) {
        st.setRemainingMs(rem);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [breakTicking, epoch, resolveBreak, endBreak]);

  // 休憩中の手動終了（長押しメニュー）も統計除外＋通知キャンセルを通す
  const stop = useCallback(() => {
    const st = useStudyTimerStore.getState();
    if (st.mode === 'break') endBreak('stop');
    else st.stop();
  }, [endBreak]);

  const skipBreak = useCallback(() => endBreak('skip'), [endBreak]);

  // 休憩の残り時間は breakEndAt（壁時計＝唯一の真実）からレンダー時に導出する。
  // store.remainingMs は休憩 tick が毎秒書く表示キャッシュにすぎず、学習画面を離れている間は
  // 更新が止まる（休憩は cleanup の書き戻しもしない設計）ため、休憩中に画面を出入りすると
  // 再マウント直後に古い値が見え、リング（パイ）の欠け具合が実際の残り時間とズレる
  // （StudyTimer のパイは effect 実行時点の remainingMs を起点にアニメーションするので、
  //  後から tick が store を直してもパイは追従しない）。導出なら初回レンダーから正しい。
  // Math.min の形にする理由: ①breakEndAt は休憩中固定＝キャッシュは「大きい側」にしか
  // ズレないので、小さい方＝壁時計が常に正 ②remainingMs を計算に含めることで、
  // React Compiler がメモ化しても tick の毎秒更新で再計算される（Date.now() だけだと
  // deps が [breakEndAt] に縮み、休憩中ずっと初回値で固定され得る）。
  const breakRemainingMs =
    mode === 'break' && phase === 'running' && breakEndAt != null
      ? Math.min(remainingMs, Math.max(0, breakEndAt - Date.now()))
      : null;

  return {
    phase,
    mode,
    cycleIndex,
    cycleCount,
    remainingMs: breakRemainingMs ?? remainingMs,
    totalMs,
    counting,
    epoch,
    togglePause,
    restart,
    stop,
    skipBreak,
  };
}
