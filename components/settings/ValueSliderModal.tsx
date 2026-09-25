import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useEffect, useRef } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { constants as KeyCommand } from 'react-native-key-command';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useKeyCommands } from '@/lib/useKeyCommands';

const isPad = (Platform as any).isPad;

interface Props {
  visible: boolean;
  /** 行と同じラベル（何を調整しているのか） */
  title: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** 値の書式。**行と同じものを渡す**（「20 枚」「90%」「1.20倍」）。両端の目盛りにも使う。 */
  format: (v: number) => string;
  /** ドラッグ中も逐次呼ばれる（インラインのスライダーと同じ＝設定は即反映・確定/取り消しは無い）。 */
  onChange: (v: number) => void;
  onClose: () => void;
  /** 053：⇧H/⇧L（⇧←/⇧→）で動かす幅。渡さなければ `step` と同じ。 */
  bigStep?: number;
}

/** 刻みに揃えて範囲へ収める。⚠️ 浮動小数の誤差を落とす（0.05 刻みは 1.2000000000000002 になる）。 */
export function normalizeStepValue(v: number, step: number, min: number, max: number) {
  const stepped = Math.round(v / step) * step;
  return Math.min(max, Math.max(min, Math.round(stepped * 1e6) / 1e6));
}

/** 053：キー操作で値を動かす（ダイアログと、学習設定の値の行で共用）。`by` は動かす幅（step の倍数）。 */
export function nudgeStepValue(value: number, dir: 1 | -1, by: number, step: number, min: number, max: number) {
  return normalizeStepValue(value + dir * by, step, min, max);
}

/**
 * 数値ひとつをスライダーで調整するダイアログ。学習設定の6箇所（目標枚数・読み上げ速度・
 * 目標保持率・学習時間・繰り返し回数・休憩時間）で使い回す。
 *
 * **なぜページ上のスライダーをやめてダイアログにしたか**：iOS の `UIScrollView` は
 * `touchesShouldCancelInContentView:` が **`UIControl` に対して NO を返す**（`UIButton` だけが例外）。
 * `UISlider` は `UIControl` なので、**スライダーの上で始まったタッチはスクロールに横取りされない**。
 * つまりスクロールする面にスライダーがある限り、上下スワイプが値を変えてしまう事故は
 * 原理的に避けられない（RN 側の props では変えられない）。折りたたみや余白の追加は
 * 確率を下げるだけなので、**スクロールする面からスライダーを外す**方法で解いている。
 *
 * ⚠️ **`patches/@react-native-community+slider+5.0.1.patch` が前提**。ライブラリの Fabric 実装は
 * `updateProps` で `_props`（**再利用時は defaultProps に戻る**）と比べて適用を決めるため、
 * `min=0` のように**既定値と同じ値が適用されず、前に開いたダイアログの min/max が残る**。
 * 6つの設定でこのダイアログを使い回す＝範囲の違うスライダーが同じネイティブビューを再利用するので、
 * パッチが外れると「休憩=なし（0）なのにつまみが一目盛ずれる」が再発する。
 * ⚠️ そのパッチは**ドラッグ中は min/max/step/value を一切適用しない**ことも含む。ここは
 * `value` を props で制御している（`onChange` → store → 再レンダー）ので、ドラッグ中に
 * min/max を入れ直すと `RNCSlider` が `_unclippedValue`（＝ドラッグ開始時の値）を書き戻し、
 * **つまみがドラッグ開始位置へ飛んでちらつく**。JS 側で直せる問題ではない（`onSlidingComplete`
 * まで値を確定しない方式にすると、上の数値表示と ± ボタンがドラッグ中に固まる）。
 *
 * ⚠️ **このダイアログの中身をスクロールさせないこと**。スクロールする面にスライダーを
 * 置いた時点で上の問題が再発する。中身はラベル・数値・スライダー・目盛り・ボタンだけで、
 * いずれも `maxFontSizeMultiplier` で頭打ちの短い行なので、最大の文字サイズでも収まる
 * （説明文は置かない＝ⓘ の説明はページ側の行に残す）。同じ理由で `maxHeight` も付けない
 * （スクロールが無いのに上限を付けると、溢れたときに ✓ ボタンが切れて閉じられなくなる）。
 */
export function ValueSliderModal({ visible, title, value, min, max, step, format, onChange, onClose, bigStep }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  // 開くフェードは JS でやる（Modal は `animationType="none"`）。iOS は VC のトランジション中に
  // タッチを配送しないため、`fade` のままだと開いた直後の操作が空振りする（CLAUDE.md の
  // 「中央ダイアログ」の項）。閉じるときは即時。
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [visible, fade]);

  // 表示中だけキーを担当する（親は `suspendKeys` でキーを手放す＝034 の住み分け）。
  // 053：H/L（,/.・←/→）＝1目盛り、⇧ つき＝`bigStep`。値が変わらない（端）ときは onChange を呼ばない。
  // 矢印は iPad でも登録する（このダイアログに入力欄は無い）。
  const move = (dir: 1 | -1, by: number) => {
    const next = nudgeStepValue(value, dir, by, step, min, max);
    if (next !== value) onChange(next);
  };
  const big = bigStep ?? step;
  const shift = KeyCommand.keyModifierShift;
  useKeyCommands([
    { input: KeyCommand.keyInputEscape, handler: onClose },
    { input: KeyCommand.keyInputEnter, handler: onClose },
    { input: 'h', handler: () => move(-1, step) },
    { input: ',', handler: () => move(-1, step) },
    { input: KeyCommand.keyInputLeftArrow, handler: () => move(-1, step) },
    { input: 'l', handler: () => move(1, step) },
    { input: '.', handler: () => move(1, step) },
    { input: KeyCommand.keyInputRightArrow, handler: () => move(1, step) },
    { input: 'h', modifierFlags: shift, handler: () => move(-1, big) },
    { input: ',', modifierFlags: shift, handler: () => move(-1, big) },
    { input: KeyCommand.keyInputLeftArrow, modifierFlags: shift, handler: () => move(-1, big) },
    { input: 'l', modifierFlags: shift, handler: () => move(1, big) },
    { input: '.', modifierFlags: shift, handler: () => move(1, big) },
    { input: KeyCommand.keyInputRightArrow, modifierFlags: shift, handler: () => move(1, big) },
  ], visible);

  const normalize = (v: number) => normalizeStepValue(v, step, min, max);

  // ± は1刻みずつの微調整用。指で合わせにくい刻み（0.05 や 1%）を狙って出せるようにする。
  const nudge = (dir: 1 | -1) => onChange(normalize(value + dir * step));
  const atMin = value <= min;
  const atMax = value >= max;

  const nudgeButton = (dir: 1 | -1, disabled: boolean) => (
    <Pressable onPress={() => nudge(dir)} disabled={disabled} hitSlop={8} style={disabled && styles.nudgeDisabled}>
      <Ionicons
        name={dir === 1 ? 'add-circle-outline' : 'remove-circle-outline'}
        size={Math.max(theme.fontSize.xl, 28)}
        color={theme.colors.primary}
      />
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, { opacity: fade }]}>
        {/* ⚠️ 背景（タップで閉じる）はダイアログの**兄弟**として背面に敷く（祖先にしない）。
            ダイアログ自身はレスポンダを持たない素の View なので、その上のタップは背景まで
            届かず「ダイアログをタップしても閉じない」も成立する。 */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
        <View style={[styles.dialog, { backgroundColor: theme.colors.surface }, isPad && styles.dialogPad]}>
          <Text
            style={[styles.title, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
            numberOfLines={2}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
          >
            {title}
          </Text>
          <Text
            style={[styles.value, { color: theme.colors.primary, fontSize: theme.fontSize.xxl }]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
          >
            {format(value)}
          </Text>

          <View style={styles.sliderRow}>
            {nudgeButton(-1, atMin)}
            <Slider
              style={styles.slider}
              minimumValue={min}
              maximumValue={max}
              step={step}
              value={value}
              onValueChange={(v) => onChange(normalize(v))}
              minimumTrackTintColor={theme.colors.primary}
              maximumTrackTintColor={theme.colors.iconSubtle}
              thumbTintColor={theme.colors.primary}
            />
            {nudgeButton(1, atMax)}
          </View>
          <View style={styles.scale}>
            <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
              {format(min)}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
              {format(max)}
            </Text>
          </View>

          <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
          <Pressable style={styles.doneBtn} onPress={onClose}>
            <Text
              style={[styles.doneBtnText, { color: theme.colors.primary, fontSize: theme.fontSize.md }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t('common.done')}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  dialog: {
    width: 300, borderRadius: 16, paddingTop: 20, paddingHorizontal: 20, paddingBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8,
  },
  // iPad は横幅を広げてスライダーを引きやすくする（InfoModal と同じ値）
  dialogPad: { width: 440, maxWidth: '90%' },
  title: { fontWeight: '600', textAlign: 'center' },
  value: { fontWeight: '700', textAlign: 'center', marginTop: 2 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  slider: { flex: 1 },
  nudgeDisabled: { opacity: 0.3 },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: -20, marginTop: 16 },
  doneBtn: { paddingVertical: 14, alignItems: 'center' },
  doneBtnText: { fontWeight: '600' },
});
