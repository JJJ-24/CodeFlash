import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();

  // 開始/再スタート（epoch が進む）から3秒間、円の左に「⏱ N分」を表示して設定時間を思い出せるようにする。
  // 表示設定（円/数字）に関係なく常に出す：数字ON でも残り分数は floor 表示で開始直後に 5→4 と
  // 変わるため「何分設定だっけ？」は同様に起こる。一時停止→再開（epoch 不変）では出さない。
  const hintOpacity = useSharedValue(0);
  const [hintVisible, setHintVisible] = useState(false);
  const hintPrevEpochRef = useRef<number | null>(null);
  useEffect(() => {
    // 本コンポーネントは timerMounted ゲートにより「開始後」にマウントされるため、開始は
    // epoch 変化だけでは検出できない（初回実行時にはすでに epoch が進んでいる）。
    // 初回実行（マウント）では「残りがほぼ満タン＝開始直後」のときだけ表示し、
    // 進行中タイマーのまま学習画面へ入り直した（別デッキ・同デッキやり直し・全画面切替）
    // ケース＝残りが減っている状態では出さない。以降は epoch 変化（再スタート等）で表示。
    const isFirstRun = hintPrevEpochRef.current === null;
    hintPrevEpochRef.current = epoch;
    if (phase !== 'running') return;
    if (isFirstRun && remainingRef.current < totalRef.current - 2000) return;
    cancelAnimation(hintOpacity);
    hintOpacity.value = 1;
    setHintVisible(true);
    hintOpacity.value = withDelay(INTRO_VISIBLE_MS, withTiming(0, { duration: INTRO_FADE_MS }));
    const id = setTimeout(() => setHintVisible(false), INTRO_VISIBLE_MS + INTRO_FADE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);
  const hintStyle = useAnimatedStyle(() => ({ opacity: hintOpacity.value }));
  const totalMinutes = Math.round(totalMs / 60_000);
  const startHint = hintVisible && totalMinutes > 0 && (
    <Animated.View style={[styles.startHintWrap, hintStyle]} pointerEvents="none">
      <View style={[styles.startHint, { backgroundColor: theme.colors.surface, borderColor: theme.colors.textTertiary + '4D' }]}>
        <Ionicons name="timer-outline" size={16} color={theme.colors.textSecondary} />
        <Text
          style={{ fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.textSecondary }}
          allowFontScaling={false}
        >
          {t('study.timerStartHint', { minutes: totalMinutes })}
        </Text>
      </View>
    </Animated.View>
  );

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
  // 数字ON のときはイントロ自体を出さず最初からゴースト＋数字（開始の合図は数字の出現で足りるし、
  // 円OFF を選んだ人にパイを見せない）。
  const fade = useSharedValue(1);
  const [introDone, setIntroDone] = useState(false);
  const [peekNonce, setPeekNonce] = useState(0);
  useEffect(() => {
    cancelAnimation(fade);
    fade.value = 1;
    if (!introOnly || phase !== 'running' || forceVisible) {
      setIntroDone(false);
      return;
    }
    if (showTime) {
      setIntroDone(true);
      return;
    }
    setIntroDone(false);
    fade.value = withDelay(INTRO_VISIBLE_MS, withTiming(0, { duration: INTRO_FADE_MS }));
    const id = setTimeout(() => setIntroDone(true), INTRO_VISIBLE_MS + INTRO_FADE_MS);
    return () => clearTimeout(id);
  }, [introOnly, epoch, phase, forceVisible, showTime, peekNonce, fade]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: blinkOpacity.value * fade.value,
  }));

  const paused = phase === 'paused';
  const secondsLeft = Math.ceil(remainingMs / 1000);
  // 数字のみ（単位なし）: 1分1秒までは分（floor）、残り1分ちょうどからは秒（60→59→…）
  const timeLabel = String(secondsLeft > 60 ? Math.floor(secondsLeft / 60) : secondsLeft);

  // フェードアウト完了後はゴースト円（薄い枠線のみ）に切り替える（終了時は blink/アラート通知のため再表示される）。
  // showTime ON なら中央に残り時間を常時表示（＝ミニマル数字タイマー）。背景はカード地なので
  // パイ上の白文字＋影ではなくテーマ文字色を使う（枠線は 30% アルファで薄く・数字はそれより濃く）。
  // 数字ON は一時停止中もパイに切り替えず、数字を pause アイコンに置き換えるだけ（このモードで
  // パイが出るのは長押しメニュー中と終了時だけ、という整理を保つ）。
  // タップ: 数字OFF＝ピーク再表示（残り時間の確認が目的。計時は継続・約3秒でまたフェードアウト）→
  // 再タップで一時停止の2段構え。数字ON＝残り時間は常に見えているのでピークを挟まず直接一時停止/再開。
  // 長押し＝どちらもメニュー（表示中は親が forceVisible を立てるため円が維持される）。
  const ghostMode =
    introOnly &&
    !forceVisible &&
    (showTime
      ? phase === 'running' || phase === 'paused'
      : introDone && phase === 'running');
  if (ghostMode) {
    return (
      <View style={style}>
        {startHint}
        <Pressable
          onPress={showTime ? onPress : () => setPeekNonce((n) => n + 1)}
          onLongPress={onLongPress}
          style={[styles.body, styles.ghost, { borderColor: theme.colors.textTertiary + '4D' }]}
          hitSlop={6}
        >
          {showTime && (
            <View style={styles.center} pointerEvents="none">
              {paused ? (
                <Ionicons name="pause" size={20} color={theme.colors.textSecondary} />
              ) : (
                <Text
                  style={{ fontSize: theme.fontSize.md, fontWeight: '700', color: theme.colors.textSecondary }}
                  allowFontScaling={false}
                  numberOfLines={1}
                >
                  {timeLabel}
                </Text>
              )}
            </View>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <Animated.View style={[style, containerStyle]}>
      {startHint}
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
  // 円非表示設定のフェードアウト後に残すゴースト円: 薄い枠線でタップ位置だけ示す
  // （不透明度は borderColor のアルファで表現。showTime の数字まで薄くしないため opacity は使わない）
  ghost: {
    borderWidth: 1,
  },
  // 開始時に円の左へ出す「⏱ N分」ピル。右アンカーのみの絶対配置は親（56pt）の幅を制約に
  // シュリンク計測されて文字末尾が潰れるため、十分な固定幅の透明ラッパーを絶対配置し、
  // その中で通常フローのピルを右寄せする（ピルは制約内の auto 幅＝パディングが正しく効く）。
  startHintWrap: {
    position: 'absolute',
    right: STUDY_TIMER_SIZE + 6,
    top: (STUDY_TIMER_SIZE - 28) / 2,
    width: 200,
    alignItems: 'flex-end',
  },
  startHint: {
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // パイの上に白数字/アイコンを載せるため、透明部分（カード背景）の上でも読めるよう影で縁取る
  overlayShadow: {
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
});
