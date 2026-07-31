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
import type { StudyTimerElementMode } from '@/store/settings';
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
// 扇が細くなりすぎて「終了より前に消えた」ように見えるのを防ぐ表示角の下限（1/90 周＝4°）。
// 扇の幅は 1° あたり外周で約 0.5pt しかないため、素直に角度＝残り割合にすると、
// 残り 1〜2°（30分タイマーなら 5〜10秒）で視認できなくなり、そこから通知までの数秒が
// 「消えたのに終わらない」空白に見える（ズレは残り割合基準なのでタイマーが長いほど長くなる）。
// 残りがある限り最低これだけの扇を残し、0 になった瞬間＝通知と同時に消す。
const PIE_MIN_FRAC = 1 / 90;
// 円非表示設定時: 開始時だけ表示し、フェードアウトして消える
const INTRO_VISIBLE_MS = 3000;
const INTRO_FADE_MS = 800;
// 休憩リング色（039）: 緑/ティール系のライト・ダークペア。学習リング（themedAccentColor＝青系 or
// カードテーマ濃色）と全カードテーマ上で識別できるよう、グレードの緑（#43A047）とも離したティール。
const BREAK_RING_LIGHT = '#26A69A';
const BREAK_RING_DARK = '#4DB6AC';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  phase: StudyTimerPhase;
  remainingMs: number;
  totalMs: number;
  /** いま実際にカウントが進んでいるか（一時停止・画面外・バックグラウンドで false） */
  counting: boolean;
  /** start/restart で進む世代番号（アニメーションの起点取り直しトリガー） */
  epoch: number;
  /** 残り時間（数字）の表示モード（studyTimerTime）: on=常時 / start=開始時＋ピーク / off=非表示 */
  timeMode: StudyTimerElementMode;
  /** 終了時 blink 動作中（円の点滅） */
  blinking: boolean;
  /** 円（パイ/ゴースト）の表示モード（studyTimerRing）: on=常時 / start=開始時＋ピーク→ゴースト / off=ゴーストのみ */
  ringMode: StudyTimerElementMode;
  /** 休憩中（039）: リングを休憩色にし「休憩中」ピルを常時表示。ringMode（ゴースト）は無視 */
  breakMode?: boolean;
  /** 現在の学習サイクル番号（1始まり）。cycleCount > 1 のとき開始ヒントに (i/n) を付ける */
  cycleIndex?: number;
  cycleCount?: number;
  /** 表示を維持する（長押しメニュー表示中など。「開始時」要素のフェードアウトを保留） */
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
  timeMode,
  blinking,
  ringMode,
  breakMode = false,
  cycleIndex = 1,
  cycleCount = 1,
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
    // 休憩開始（startBreak）も epoch を進めるが「⏱ N分」は学習の合図なので出さない
    // （休憩開始の合図はピル自身）。休憩→学習の epoch では通常どおり発火する。
    if (breakMode) return;
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
          {cycleCount > 1
            ? t('study.timerStartHintCycle', { minutes: totalMinutes, i: cycleIndex, n: cycleCount })
            : t('study.timerStartHint', { minutes: totalMinutes })}
        </Text>
      </View>
    </Animated.View>
  );

  // 休憩中は「☕ 休憩中」ピルをフェードなしで常時表示（startHint と同じスタイルを再利用）
  const breakPill = breakMode && (
    <View style={styles.startHintWrap} pointerEvents="none">
      <View style={[styles.startHint, { backgroundColor: theme.colors.surface, borderColor: theme.colors.textTertiary + '4D' }]}>
        <Ionicons name="cafe-outline" size={16} color={theme.colors.textSecondary} />
        <Text
          style={{ fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.textSecondary }}
          allowFontScaling={false}
        >
          {t('study.breakPill')}
        </Text>
      </View>
    </View>
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
  //
  // パイは連続（スムーズ）に欠けさせる: 開始「60」は正円で、1秒かけて6°（1分設定時）
  // 欠けたところで「59」になる＝数字の変わり目とパイの欠け量が一致する。
  // ※「残り秒の切り上げで1秒＝1目盛りの段階欠け（ceil ステップ）」は実機でカクついて見えるため
  //   不採用（2026-07-13 試行済み・再試行しない）。
  //
  // 表示角には下限（PIE_MIN_FRAC）を敷き、[0,1] を [PIE_MIN_FRAC,1] へ線形に写す。残りがある間は
  // 必ず見える太さの扇が残り、progress がちょうど 0 になった瞬間（＝tick が時間切れを検出して
  // 通知を出すのと同じ壁時計上の点）に消える＝「消えた瞬間が終了」になる。
  // 床を張る（Math.max(p, min)）方式にしないのは、最後の 1/90 で扇が停滞して見えるため。
  // 線形マップなら速度は (1-min) 倍でほぼ変わらず、最後に 4° ぶんが一瞬で消えるだけで済む。
  const animatedProps = useAnimatedProps(() => {
    const p = progress.value;
    const shown = p > 0 ? PIE_MIN_FRAC + (1 - PIE_MIN_FRAC) * p : 0;
    return { strokeDashoffset: PIE_CIRCUMFERENCE * (1 + shown) };
  });

  const blinkOpacity = useSharedValue(1);
  useEffect(() => {
    if (blinking) {
      blinkOpacity.value = withRepeat(withTiming(0.25, { duration: 450 }), -1, true);
    } else {
      cancelAnimation(blinkOpacity);
      blinkOpacity.value = withTiming(1, { duration: 150 });
    }
  }, [blinking, blinkOpacity]);

  // 「開始時」要素（円 or 残り時間）を、計時開始（マウント・再スタート・一時停止からの再開）と
  // タップのピークごとに INTRO_VISIBLE_MS 表示 → フェードアウトして隠す共通ウィンドウ。隠れた後は
  // 円='start'→ゴースト枠線 / 残り時間='start'→非表示。要素の on/off はこのウィンドウと無関係に常時反映。
  // 休憩中・終了/一時停止中・forceVisible 中はフェードせず表示を維持する（休憩はカードがグレーアウト済みで
  // クリーンに保つ動機が消え、リングが唯一の残り休憩時間の確認手段になるため）。
  const transient = useSharedValue(1);
  const [transientShown, setTransientShown] = useState(true);
  const [peekNonce, setPeekNonce] = useState(0);
  const hasStartEl = ringMode === 'start' || timeMode === 'start';
  useEffect(() => {
    cancelAnimation(transient);
    transient.value = 1;
    if (breakMode || phase !== 'running' || forceVisible) {
      setTransientShown(true);
      return;
    }
    // 「開始時」要素が無ければウィンドウは即クローズ（表示は on/off だけで決まる）。
    if (!hasStartEl) {
      setTransientShown(false);
      return;
    }
    setTransientShown(true);
    transient.value = withDelay(INTRO_VISIBLE_MS, withTiming(0, { duration: INTRO_FADE_MS }));
    const id = setTimeout(() => setTransientShown(false), INTRO_VISIBLE_MS + INTRO_FADE_MS);
    return () => clearTimeout(id);
  }, [ringMode, timeMode, epoch, phase, forceVisible, breakMode, hasStartEl, peekNonce, transient]);
  const transientStyle = useAnimatedStyle(() => ({ opacity: transient.value }));

  const containerStyle = useAnimatedStyle(() => ({
    opacity: blinkOpacity.value,
  }));

  const paused = phase === 'paused';
  const secondsLeft = Math.ceil(remainingMs / 1000);
  // 数字のみ（単位なし）: 1分1秒までは分（floor）、残り1分ちょうどからは秒（60→59→…）
  const timeLabel = String(secondsLeft > 60 ? Math.floor(secondsLeft / 60) : secondsLeft);

  // 円（パイ）を出すか:
  // - 終了(blink/アラート)は設定に関係なく常に出す（時間切れの合図）。
  // - 休憩中はタップ無効＝ピーク不可なので必ず1つは残り時間の指標を残す: 円=常に(on) のとき、
  //   または数字も出ない（time!=='on'）ときのフォールバックとして円を出す。数字だけ出るとき
  //   （ring≠on かつ time==='on'）は円を出さない（＝円オフの意図を休憩中も尊重）。
  // - 通常は ringMode に従い on=常時 / start=ウィンドウ中のみ / off=出さない（ゴースト枠線）。
  const showPie =
    phase === 'finished' ||
    (breakMode
      ? ringMode === 'on' || timeMode !== 'on'
      : ringMode === 'on' || (ringMode === 'start' && transientShown));
  // ウィンドウ中だけ出るパイ（=フェード対象）。休憩・終了の常時パイはフェードしない。
  const pieIsTransient = showPie && ringMode === 'start' && !breakMode && phase !== 'finished';
  // 数字を出すか: on=常時 / start=ウィンドウ中のみ（休憩中は出さない）/ off=出さない。
  const timeVisible = timeMode === 'on' || (timeMode === 'start' && transientShown && !breakMode);
  const numberIsTransient = timeVisible && timeMode === 'start';
  // 数字/pause アイコンの配色: パイの上＝白＋影 / ゴースト（カード地の上）＝テーマ文字色。
  const onPie = showPie;

  // タップ: ピークは「『常に(on)』表示が無く（円も残り時間も on でない）、隠れている『開始時(start)』
  // 表示があるとき」だけ＝3パターン（円start+時間start／円start+時間off／円off+時間start）。1回目で
  // その表示を数秒再表示（計時は継続・約3秒で再フェード）→ ピーク中の再タップで一時停止の2段構え。
  // 円か残り時間のどちらかが「常に」表示のとき（見えているものを直接止めたい）と両方 off のときは
  // 直接 onPress（一時停止/再開）。長押しはメニュー（表示中は親が forceVisible を立てて表示を維持）。
  function handlePress() {
    if (
      phase === 'running' && !breakMode &&
      ringMode !== 'on' && timeMode !== 'on' && hasStartEl && !transientShown
    ) {
      setPeekNonce((n) => n + 1);
      return;
    }
    onPress();
  }

  return (
    <Animated.View style={[style, containerStyle]}>
      {breakMode ? breakPill : startHint}
      <Pressable
        onPress={handlePress}
        onLongPress={onLongPress}
        style={[styles.body, onPie && paused && { opacity: 0.5 }]}
        hitSlop={6}
      >
        {showPie ? (
          <Animated.View style={pieIsTransient ? transientStyle : undefined}>
            <Svg width={STUDY_TIMER_SIZE} height={STUDY_TIMER_SIZE}>
              <AnimatedCircle
                cx={HALF}
                cy={HALF}
                r={PIE_RADIUS}
                stroke={breakMode ? (theme.dark ? BREAK_RING_DARK : BREAK_RING_LIGHT) : themedAccentColor(theme)}
                strokeWidth={PIE_STROKE}
                fill="none"
                strokeDasharray={[PIE_CIRCUMFERENCE, PIE_CIRCUMFERENCE]}
                animatedProps={animatedProps}
                rotation={-90}
                originX={HALF}
                originY={HALF}
              />
            </Svg>
          </Animated.View>
        ) : (
          <View style={[styles.body, styles.ghost, { borderColor: theme.colors.textTertiary + '4D' }]} />
        )}
        {(paused || timeVisible) && (
          <View style={styles.center} pointerEvents="none">
            {paused ? (
              <Ionicons
                name="pause"
                size={20}
                color={onPie ? '#FFF' : theme.colors.textSecondary}
                style={onPie ? styles.overlayShadow : undefined}
              />
            ) : (
              <Animated.Text
                style={[
                  numberIsTransient && transientStyle,
                  onPie ? styles.overlayShadow : undefined,
                  { fontSize: theme.fontSize.md, fontWeight: '700', color: onPie ? '#FFF' : theme.colors.textSecondary },
                ]}
                allowFontScaling={false}
                numberOfLines={1}
              >
                {timeLabel}
              </Animated.Text>
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
  // 円が非表示（ring=start のフェード後／ring=off）のとき残すゴースト円: 薄い枠線でタップ位置だけ示す
  // （不透明度は borderColor のアルファで表現。中央の残り時間の数字まで薄くしないため opacity は使わない）
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
