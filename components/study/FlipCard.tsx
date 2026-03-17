import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/lib/theme';

export interface FlipCardRef {
  resetInstant: () => void;
}

interface Props {
  front: React.ReactNode;
  back: React.ReactNode;
  isFlipped: boolean;
  onFlip: () => void;
  cardStyle?: ViewStyle;
  innerStyle?: ViewStyle;
}

export const FlipCard = forwardRef<FlipCardRef, Props>(
  ({ front, back, isFlipped, onFlip, cardStyle, innerStyle }, ref) => {
    const progress = useSharedValue(0);
    const theme = useTheme();

    useImperativeHandle(ref, () => ({
      resetInstant: () => { progress.value = 0; },
    }));

    useEffect(() => {
      progress.value = withTiming(isFlipped ? 1 : 0, { duration: 320 });
    }, [isFlipped]);

    const frontStyle = useAnimatedStyle(() => {
      const rotateY = interpolate(progress.value, [0, 1], [0, 180], Extrapolation.CLAMP);
      return {
        transform: [{ perspective: 1200 }, { rotateY: `${rotateY}deg` }],
        backfaceVisibility: 'hidden',
      };
    });

    const backStyle = useAnimatedStyle(() => {
      const rotateY = interpolate(progress.value, [0, 1], [180, 360], Extrapolation.CLAMP);
      return {
        transform: [{ perspective: 1200 }, { rotateY: `${rotateY}deg` }],
        backfaceVisibility: 'hidden',
      };
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const tapGesture = useMemo(
      () => Gesture.Tap().maxDistance(10).onEnd(() => runOnJS(onFlip)()),
      [onFlip]
    );

    return (
      <GestureDetector gesture={tapGesture}>
        <View style={styles.wrapper}>
          <View style={styles.cardContainer}>
            {/* 表面 — 裏向きのときはタッチを透過させる */}
            <Animated.View
              style={[styles.card, { backgroundColor: theme.colors.surface }, cardStyle, frontStyle]}
              pointerEvents={isFlipped ? 'none' : 'box-none'}
            >
              <View style={[styles.cardInner, innerStyle]}>{front}</View>
            </Animated.View>
            {/* 裏面 — 表向きのときはタッチを透過させる */}
            <Animated.View
              style={[styles.card, { backgroundColor: theme.colors.surface }, cardStyle, backStyle]}
              pointerEvents={isFlipped ? 'box-none' : 'none'}
            >
              <View style={[styles.cardInner, innerStyle]}>{back}</View>
            </Animated.View>
          </View>
        </View>
      </GestureDetector>
    );
  }
);

FlipCard.displayName = 'FlipCard';

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  cardContainer: { flex: 1, position: 'relative' },
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  cardInner: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
});
