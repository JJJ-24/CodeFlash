import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { StyleSheet } from 'react-native';

const MIN_SCALE = 1;
const MAX_SCALE = 5;

interface Props {
  uri: string;
  alt?: string;
  height?: number;
}

export function ZoomableImage({ uri, alt, height = 220 }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, MIN_SCALE), MAX_SCALE);
    })
    .onEnd(() => {
      if (scale.value < MIN_SCALE) {
        scale.value = withSpring(MIN_SCALE);
        savedScale.value = MIN_SCALE;
      } else {
        savedScale.value = scale.value;
      }
    });

  // ダブルタップはカードフリップ（Pressable）と衝突するためロングプレスでリセット
  const longPress = Gesture.LongPress()
    .minDuration(500)
    .onEnd(() => {
      scale.value = withSpring(MIN_SCALE);
      savedScale.value = MIN_SCALE;
    });

  const gesture = Gesture.Simultaneous(pinch, longPress);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.container, { height }, animatedStyle]}>
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="contain"
          transition={200}
          accessibilityLabel={alt || undefined}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
