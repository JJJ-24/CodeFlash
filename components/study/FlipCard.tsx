import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/lib/theme';

interface Props {
  front: React.ReactNode;
  back: React.ReactNode;
  isFlipped: boolean;
  onFlip: () => void;
}

export function FlipCard({ front, back, isFlipped, onFlip }: Props) {
  const progress = useSharedValue(0);
  const theme = useTheme();

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

  return (
    <Pressable style={styles.wrapper} onPress={onFlip}>
      <View style={styles.cardContainer}>
        {/* 表面 — 裏向きのときはタッチを透過させる */}
        <Animated.View
          style={[styles.card, { backgroundColor: theme.colors.surface }, frontStyle]}
          pointerEvents={isFlipped ? 'none' : 'box-none'}
        >
          <View style={styles.cardInner}>{front}</View>
        </Animated.View>
        {/* 裏面 — 表向きのときはタッチを透過させる */}
        <Animated.View
          style={[styles.card, { backgroundColor: theme.colors.surface }, backStyle]}
          pointerEvents={isFlipped ? 'box-none' : 'none'}
        >
          <View style={styles.cardInner}>{back}</View>
        </Animated.View>
      </View>
    </Pressable>
  );
}

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
