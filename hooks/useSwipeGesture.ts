import { useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import type { FlipCardRef } from '@/components/study/FlipCard';

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
  const isNavigatingRef = useRef(false);

  // JS-thread callbacks for swipe gestures (called via runOnJS — must be named functions)
  function onSwipedLeft() {
    flipCardRef.current?.resetInstant();
    onReset();
    slideInDirRef.current = 1;
    goNext();
  }

  function onSwipedRight() {
    flipCardRef.current?.resetInstant();
    onReset();
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

  // カードインデックス変化後のスライドイン処理（useEffect([currentIndex]) から呼ぶ）
  function applySlideIn(sw: number) {
    const dir = slideInDirRef.current;
    slideInDirRef.current = 0;
    if (dir !== 0) {
      // 新カードコンテンツがコミット済み。translateX リセットとスライドインをアトミックに実行
      runOnUI(() => {
        'worklet';
        translateX.value = 0;
        slideX.value = dir > 0 ? sw : -sw;
        slideX.value = withTiming(0, { duration: 180 });
      })();
      setTimeout(() => { isNavigatingRef.current = false; }, 200);
    } else {
      // セッション初期ロード時など: 位置をリセット
      runOnUI(() => {
        'worklet';
        translateX.value = 0;
        slideX.value = 0;
      })();
    }
  }

  function navigateWithSlide(direction: 'next' | 'prev', action?: () => void) {
    if (isNavigatingRef.current) return;
    if (direction === 'prev' && currentIndex === 0) return;
    isNavigatingRef.current = true;

    const slideOut = direction === 'next' ? -screenWidth : screenWidth;

    // スライドアウト後、slideInDirRef をセットして goNext/goBack を呼ぶ
    // スライドインは applySlideIn() 内で新カードコミット後に開始する
    slideX.value = withTiming(slideOut, { duration: 180 });
    setTimeout(() => {
      flipCardRef.current?.resetInstant();
      onReset();
      slideInDirRef.current = direction === 'next' ? 1 : -1;
      if (action) action();
      else if (direction === 'next') goNext();
      else goBack();
    }, 180);
  }

  return {
    currentIndexSV,
    panGesture,
    cardAnimStyle,
    navigateWithSlide,
    applySlideIn,
  };
}
