import { Image } from 'expo-image';
import { useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const MIN_SCALE = 1;
const MAX_SCALE = 5;

interface Props {
  uri: string;
  alt?: string;
  /** 表示の最大幅（px）。実表示幅は min(maxWidth, 親幅) にクランプされる。 */
  maxWidth?: number;
}

export function ZoomableImage({ uri, alt, maxWidth = 360 }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  // 画像の実寸アスペクト比（幅/高さ）と、利用可能幅（onLayout で測定）。
  // 両方そろったら幅・高さを具体値で確定する（aspectRatio + maxWidth のクランプずれで
  // コンテナだけ縦に伸び、画像下に余白が出る問題を避けるため JS 側で実寸を計算する）。
  const [ratio, setRatio] = useState<number | null>(null);
  const [availWidth, setAvailWidth] = useState(0);

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

  let boxStyle: { width: number | `${number}%`; height: number };
  if (ratio && availWidth) {
    let w = Math.min(maxWidth, availWidth);
    let h = w / ratio;
    const maxH = Dimensions.get('window').height * 0.7; // 極端な縦長の頭打ち
    if (h > maxH) { h = maxH; w = h * ratio; }
    boxStyle = { width: w, height: h };
  } else {
    boxStyle = { width: '100%', height: 220 }; // 測定・読込前の仮表示
  }

  return (
    <View style={styles.wrap} onLayout={(e) => setAvailWidth(e.nativeEvent.layout.width)}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.container, boxStyle, animatedStyle]}>
          <Image
            source={{ uri }}
            style={styles.image}
            contentFit="contain"
            transition={200}
            accessibilityLabel={alt || undefined}
            onLoad={(e) => {
              const w = e.source?.width;
              const h = e.source?.height;
              if (w && h) setRatio(w / h);
            }}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  container: {
    alignSelf: 'center',
    borderRadius: 8,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
