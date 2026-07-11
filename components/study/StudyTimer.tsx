import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { themedAccentColor, useTheme } from '@/lib/theme';
import type { StudyTimerPhase } from '@/store/studyTimer';

// navFab と同じ 56pt の円形フローティング
export const STUDY_TIMER_SIZE = 56;
const HALF = STUDY_TIMER_SIZE / 2;
// パイ（塗りつぶし円が欠けていく）表現: 半径 r・ストローク幅 2r の円は
// ストロークが中心から外周まで（r-w/2=0 〜 r+w/2=2r）を覆う＝塗りつぶし円になり、
// strokeDasharray/offset で扇形（パイ）として欠けさせられる。欠けた部分は透明＝カード背景が見える。
const PIE_RADIUS = STUDY_TIMER_SIZE / 4;
const PIE_STROKE = STUDY_TIMER_SIZE / 2;
const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS;
// 円非表示設定時: 開始時だけ表示し、フェードアウトして消える
const INTRO_VISIBLE_MS = 3000;
const INTRO_FADE_MS = 800;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  phase: StudyTimerPhase;
  remainingMs: number;
  totalMs: number;
  /** いま実際にカウントが進んでいるか（一時停止・画面外・バックグラウンドで false） */
  counting: boolean;
  /** start/restart で進む世代番号（アニメーションの起点取り直しトリガー） */
  epoch: number;
  /** 中央に残り時間の数字を表示（studyTimerShowTime） */
  showTime: boolean;
  /** 終了時 blink 動作中（円の点滅） */
  blinking: boolean;
  /** 円非表示設定（studyTimerRingVisible=false）: 開始時のみ表示→フェードアウト */
  introOnly: boolean;
  /** 表示を維持する（長押しメニュー表示中など。introOnly のフェードアウトを保留） */
  forceVisible?: boolean;
  onPress: () => void;
  onLongPress: () => void;
  /** 親画面側の絶対配置スタイル */
  style?: StyleProp<ViewStyle>;
}

export function StudyTimer({
  phase,
  remainingMs,
  totalMs,
  counting,
  epoch,
  showTime,
  blinking,
  introOnly,
  forceVisible = false,
  onPress,
  onLongPress,
  style,
}: Props) {
  const theme = useTheme();

  // パイの進行は reanimated の UI スレッドで連続アニメーションさせる（store の秒粒度更新だとカクつく）。
  // counting 中は「現在の残り割合 → 0」へ残り時間ぶんの線形アニメーション、停止時は現在値へスナップ。
  const progress = useSharedValue(1);
  const remainingRef = useRef(remainingMs);
  remainingRef.current = remainingMs;
  const totalRef = useRef(totalMs);
  totalRef.current = totalMs;
  useEffect(() => {
    cancelAnimation(progress);
    if (phase === 'finished') {
      // 終了時（blink 通知）は満円
      progress.value = 1;
      return;
    }
    const frac =
      totalRef.current > 0 ? Math.max(0, Math.min(1, remainingRef.current / totalRef.current)) : 0;
    progress.value = frac;
    if (counting) {
      progress.value = withTiming(0, { duration: remainingRef.current, easing: Easing.linear });
    }
  }, [counting, epoch, phase, progress]);

  // 12時起点・時計回りに欠ける表現:
  // rotate(-90) でパス始点を12時に置くと、offset = C*(1+fraction) は
  // 「パス位置 C*(1-fraction)〜C」＝残り扇形の終端を12時に固定し、始端が時計回りに進む
  // （標準の C*(1-fraction) だと反時計回りに欠けてしまう）。
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: PIE_CIRCUMFERENCE * (1 + progress.value),
  }));

  const blinkOpacity = useSharedValue(1);
  useEffect(() => {
    if (blinking) {
      blinkOpacity.value = withRepeat(withTiming(0.25, { duration: 450 }), -1, true);
    } else {
      cancelAnimation(blinkOpacity);
      blinkOpacity.value = withTiming(1, { duration: 150 });
    }
  }, [blinking, blinkOpacity]);

  // 円非表示設定: 計時開始（マウント・再スタート・一時停止からの再開）とゴーストタップ（ピーク）ごとに
  // INTRO_VISIBLE_MS 表示 → フェードアウト → ゴースト円へ。一時停止・終了中・forceVisible 中は表示を維持する。
  const fade = useSharedValue(1);
  const [introDone, setIntroDone] = useState(false);
  const [peekNonce, setPeekNonce] = useState(0);
  useEffect(() => {
    cancelAnimation(fade);
    fade.value = 1;
    setIntroDone(false);
    if (!introOnly || phase !== 'running' || forceVisible) return;
    fade.value = withDelay(INTRO_VISIBLE_MS, withTiming(0, { duration: INTRO_FADE_MS }));
    const id = setTimeout(() => setIntroDone(true), INTRO_VISIBLE_MS + INTRO_FADE_MS);
    return () => clearTimeout(id);
  }, [introOnly, epoch, phase, forceVisible, peekNonce, fade]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: blinkOpacity.value * fade.value,
  }));

  const paused = phase === 'paused';
  const secondsLeft = Math.ceil(remainingMs / 1000);
  // 数字のみ（単位なし）: 1分1秒までは分（floor）、残り1分ちょうどからは秒（60→59→…）
  const timeLabel = String(secondsLeft > 60 ? Math.floor(secondsLeft / 60) : secondsLeft);

  // フェードアウト完了後はゴースト円（薄い枠線のみ）に切り替える（終了時は blink/アラート通知のため再表示される）。
  // タップ＝ピーク再表示（計時は継続・約3秒でまたフェードアウト）、長押し＝通常どおりメニュー
  // （メニュー表示中は親が forceVisible を立てるため円が維持される）。
  if (introOnly && introDone && phase === 'running') {
    return (
      <View style={style}>
        <Pressable
          onPress={() => setPeekNonce((n) => n + 1)}
          onLongPress={onLongPress}
          style={[styles.body, styles.ghost, { borderColor: theme.colors.textTertiary }]}
          hitSlop={6}
        />
      </View>
    );
  }

  return (
    <Animated.View style={[style, containerStyle]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={[styles.body, paused && { opacity: 0.5 }]}
        hitSlop={6}
      >
        <Svg width={STUDY_TIMER_SIZE} height={STUDY_TIMER_SIZE}>
          <AnimatedCircle
            cx={HALF}
            cy={HALF}
            r={PIE_RADIUS}
            stroke={themedAccentColor(theme)}
            strokeWidth={PIE_STROKE}
            fill="none"
            strokeDasharray={[PIE_CIRCUMFERENCE, PIE_CIRCUMFERENCE]}
            animatedProps={animatedProps}
            rotation={-90}
            originX={HALF}
            originY={HALF}
          />
        </Svg>
        {(paused || showTime) && (
          <View style={styles.center} pointerEvents="none">
            {paused ? (
              <Ionicons name="pause" size={20} color="#FFF" style={styles.overlayShadow} />
            ) : (
              <Text
                style={[
                  styles.overlayShadow,
                  { fontSize: theme.fontSize.md, fontWeight: '700', color: '#FFF' },
                ]}
                allowFontScaling={false}
                numberOfLines={1}
              >
                {timeLabel}
              </Text>
            )}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: {
    width: STUDY_TIMER_SIZE,
    height: STUDY_TIMER_SIZE,
    borderRadius: STUDY_TIMER_SIZE / 2,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 円非表示設定のフェードアウト後に残すゴースト円: 薄い枠線のみでタップ位置だけ示す
  ghost: {
    borderWidth: 1,
    opacity: 0.3,
  },
  // パイの上に白数字/アイコンを載せるため、透明部分（カード背景）の上でも読めるよう影で縁取る
  overlayShadow: {
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
});
