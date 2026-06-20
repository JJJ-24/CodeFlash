import { useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { Easing, runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import type { FlipCardRef } from '@/components/study/FlipCard';

// スライドイン（新カードが横から入る）の所要時間。
// 減速イージング（Easing.out）と合わせて、スワイプに近いゆったりした入りにする。
const SLIDE_DURATION_MS = 480;
// 直前のめくりからこの時間内に次の入力が来たら「連打」とみなし、アニメをスナップして即送りする
// （待ち時間ゼロ・取りこぼしなし）。これより後の入力は「単発」としてスライドで見せる。
// この判定はめくり枚数には一切影響せず、見た目（アニメするか/スナップするか）だけを決める。
const RAPID_WINDOW_MS = 200;

interface Options {
  screenWidth: number;
  currentIndex: number;
  goNext: () => void;
  goBack: () => void;
  flipCardRef: React.RefObject<FlipCardRef | null>;
  onReset: () => void;
}

export function useSwipeGesture({ screenWidth, currentIndex, goNext, goBack, flipCardRef, onReset }: Options) {
  const translateX = useSharedValue(0);
  const slideX = useSharedValue(0);
  const currentIndexSV = useSharedValue(currentIndex);
  const slideInDirRef = useRef(0);
  // 直前にめくった時刻（連打判定用）。RAPID_WINDOW_MS と比較する。
  const lastNavAtRef = useRef(0);

  // JS-thread callbacks for swipe gestures (called via runOnJS — must be named functions)
  function onSwipedLeft() {
    flipCardRef.current?.resetInstant();
    onReset();
    lastNavAtRef.current = Date.now();
    slideInDirRef.current = 1;
    goNext();
  }

  function onSwipedRight() {
    flipCardRef.current?.resetInstant();
    onReset();
    lastNavAtRef.current = Date.now();
    slideInDirRef.current = -1;
    goBack();
  }

  function cancelSwipe() {
    translateX.value = withSpring(0);
  }

  const panGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      translateX.value = e.translationX * 0.3;
    })
    .onEnd((e) => {
      const swipeLeft  = e.translationX < -80 || e.velocityX < -500;
      const swipeRight = e.translationX > 80  || e.velocityX > 500;
      if (swipeLeft) {
        translateX.value = withTiming(-screenWidth, { duration: 150 }, (finished) => {
          if (finished) runOnJS(onSwipedLeft)();
          else runOnJS(cancelSwipe)();
        });
      } else if (swipeRight) {
        if (currentIndexSV.value === 0) {
          translateX.value = withSpring(0);
        } else {
          translateX.value = withTiming(screenWidth, { duration: 150 }, (finished) => {
            if (finished) runOnJS(onSwipedRight)();
            else runOnJS(cancelSwipe)();
          });
        }
      } else {
        translateX.value = withSpring(0);
      }
    });

  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value + slideX.value }],
  }));

  // カードインデックス変化後の見た目反映（useEffect([currentIndex]) から呼ぶ）。
  // slideInDirRef が ±1 のとき＝単発: 新カードを横からスライドイン。
  // 0 のとき＝連打 or 初期ロード: アニメなしで即表示（進行中スライドも slideX=0 で中断する）。
  function applySlideIn(sw: number) {
    const dir = slideInDirRef.current;
    slideInDirRef.current = 0;
    if (dir !== 0) {
      // 新カードコンテンツがコミット済み。translateX リセットとスライドインをアトミックに実行
      runOnUI(() => {
        'worklet';
        translateX.value = 0;
        slideX.value = dir > 0 ? sw : -sw;
        slideX.value = withTiming(0, { duration: SLIDE_DURATION_MS, easing: Easing.out(Easing.cubic) });
      })();
    } else {
      // 連打時・初期ロード: 位置を即リセット（slideX=0 が進行中の withTiming を打ち切る）
      runOnUI(() => {
        'worklet';
        translateX.value = 0;
        slideX.value = 0;
      })();
    }
  }

  // ボタン・キーボード・スワイプ（評価送り）共通のカード送り。
  // 【設計】めくり枚数の権限は「入力イベント」が持つ＝goNext/goBack を即同期実行してコミットする。
  // アニメは applySlideIn が後追いで見せるだけで、めくり枚数には一切関与しない。これにより、
  // 連打しても①待ち時間なし ②取りこぼしなし ③指を離した後に余分にめくれる（オーバーシュート）なし。
  // 単発（直前のめくりから RAPID_WINDOW_MS 経過）はスライド、連打中はスナップで「パラパラ」送る。
  function navigateWithSlide(direction: 'next' | 'prev', action?: () => void) {
    if (direction === 'prev' && currentIndex === 0) return;

    const now = Date.now();
    const rapid = now - lastNavAtRef.current < RAPID_WINDOW_MS;
    lastNavAtRef.current = now;

    flipCardRef.current?.resetInstant();
    onReset();
    // 連打中は 0（スナップ）、単発は方向（スライド）。見た目のみ決定。
    const dir = rapid ? 0 : direction === 'next' ? 1 : -1;
    slideInDirRef.current = dir;
    // 新カードがコミット（描画）される前に開始位置をここで先に入れておく。これをやらないと、
    // applySlideIn（useEffect 経由の runOnUI）が開始位置を入れる前に、新カードが中央(slideX=0)で
    // 1フレームだけ描画され、文字が「ちらっと」見えてからスライドインする（数枚に一度発生）。
    // 先に ±screenWidth へ寄せておけば最初の描画から画面外スタートになりちらつかない
    // （連打 dir=0 は中央=即表示＝スナップ）。applySlideIn は同値を入れて 0 へアニメする。
    slideX.value = dir > 0 ? screenWidth : dir < 0 ? -screenWidth : 0;
    if (action) action();
    else if (direction === 'next') goNext();
    else goBack();
  }

  return {
    currentIndexSV,
    panGesture,
    cardAnimStyle,
    navigateWithSlide,
    applySlideIn,
  };
}
