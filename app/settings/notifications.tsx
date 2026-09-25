import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { constants as KeyCommand } from 'react-native-key-command';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppSwitch } from '@/components/AppSwitch';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { InfoModal } from '@/components/InfoModal';
import { SwipeToDeleteRow } from '@/components/SwipeToDeleteRow';
import { SettingsDetail } from '@/components/settings/SettingsDetail';
import { SettingsFocusCard, SettingsFocusGroup, SettingsFocusRow } from '@/components/settings/settingsFocus';
import { settingsStyles as styles } from '@/components/settings/styles';
import {
  MAX_SCHEDULES,
  countSchedules, createSchedule, deleteSchedule, getAllSchedules,
  toggleScheduleEnabled, updateSchedule,
} from '@/lib/database/notifications';
import { popEscDismiss, pushEscDismiss, removeEscDismiss } from '@/lib/escStack';
import {
  cancelAllScheduledNotifications, isPermissionGranted, requestPermission, scheduleFromDb,
} from '@/lib/notifications';
import { useTheme, MAX_FONT_MULTIPLIER, themedFrameBorder } from '@/lib/theme';
import { deleteKeySpecs, useKeyCommands } from '@/lib/useKeyCommands';
import { useSettingsStore } from '@/store/settings';
import type { NotificationSchedule } from '@/types';

const WEEKDAY_COUNT = 7;

function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

const WEEKDAY_SHORT_JA = ['日', '月', '火', '水', '木', '金', '土'];
const WEEKDAY_SHORT_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getWeekdayShort(t: ReturnType<typeof useTranslation>['t']): string[] {
  const sample = t('notification.weekdayShort.0');
  return sample === '日' ? WEEKDAY_SHORT_JA : WEEKDAY_SHORT_EN;
}

function formatWeekdays(weekdays: number[], dayNames: string[], t: ReturnType<typeof useTranslation>['t']): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  if (sorted.length === 0 || sorted.length === WEEKDAY_COUNT) return t('notification.weekdayEvery');
  const isWeekdays = sorted.length === 5 && sorted.every((d) => d >= 1 && d <= 5);
  if (isWeekdays) return t('notification.weekdayWeekdays');
  const isWeekend = sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6;
  if (isWeekend) return t('notification.weekdayWeekend');
  return sorted.map((d) => dayNames[d]).join('・');
}

// ────────────────────────────────────────────────────────
// スケジュール追加・編集モーダル（ボトムシート）
// ────────────────────────────────────────────────────────

interface ScheduleModalProps {
  visible: boolean;
  isNew: boolean;
  hour: number;
  minute: number;
  weekdays: number[];
  label: string;
  theme: ReturnType<typeof useTheme>;
  bottomInset: number;
  onChangeTime: (h: number, m: number) => void;
  onToggleWeekday: (day: number) => void;
  onChangeLabel: (v: string) => void;
  /** 046: 目標が未達成のときだけ通知するか。**目標 OFF のときは無効表示にする** */
  onlyIfGoalUnmet: boolean;
  onChangeOnlyIfGoalUnmet: (v: boolean) => void;
  goalEnabled: boolean;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** 053：シートの中でフォーカスできる項目（上から順）。目標 OFF のときは「目標未達成」を外す（押しても効かないため）。 */
type SheetFocus = 'hour' | 'minute' | 'weekdays' | 'label' | 'goal';

function ScheduleModal({
  visible, isNew, hour, minute, weekdays, label, theme, bottomInset,
  onChangeTime, onToggleWeekday, onChangeLabel, onSave, onDelete, onClose,
  onlyIfGoalUnmet, onChangeOnlyIfGoalUnmet, goalEnabled,
}: ScheduleModalProps) {
  const { t } = useTranslation();
  const { height: screenHeight } = useWindowDimensions();
  const sheetY = useSharedValue(screenHeight);
  const overlayOpacity = useSharedValue(0);
  // 「目標未達成のみ」の説明（ⓘ でインライン展開）。設定サブ画面の ⓘ と同じ流儀で、
  // 自前のキーは持たず escStack に積む＝Esc は「説明 → シート → 画面」の順に1段ずつ閉じる。
  const [showInfo, setShowInfo] = useState(false);
  useEffect(() => {
    if (!showInfo) return;
    const id = pushEscDismiss(() => setShowInfo(false));
    return () => removeEscDismiss(id);
  }, [showInfo]);
  // シートを閉じたら畳む（次に開いたときは説明なしから始める）。
  useEffect(() => { if (!visible) setShowInfo(false); }, [visible]);
  // ラベル欄にカーソルを置いたとき、末尾まで送ってキーボードの上へ出す。
  // ⚠️ **キーボードのアニメーション（約250ms）を待ってから送る**＝余白（キーボード insets）が
  // 増えるより先に送っても届かない。`automaticallyAdjustKeyboardInsets` 任せにせず明示的に
  // 送るのは、どこまで自動で送られるかが端末・OS で揺れるため（送り先は同じ位置）。
  const scrollRef = useRef<ScrollView>(null);

  // ---- 053：キーボード操作（docs/053「通知画面」の編集シート） ----
  const focusOrder: SheetFocus[] = ['hour', 'minute', 'weekdays', 'label', ...(goalEnabled ? ['goal' as const] : [])];
  const [focus, setFocus] = useState<SheetFocus | null>(null);
  useEffect(() => { if (visible) setFocus(null); }, [visible]);
  const labelRef = useRef<TextInput>(null);
  const [labelEditing, setLabelEditing] = useState(false);
  const scrollYRef = useRef(0);
  const viewportHRef = useRef(0);
  const sectionLayouts = useRef<Partial<Record<'time' | 'weekdays' | 'label' | 'goal', { y: number; h: number }>>>({});
  const sectionOf = (f: SheetFocus) => (f === 'hour' || f === 'minute' ? 'time' : f);
  const scrollIntoView = (f: SheetFocus) => {
    const l = sectionLayouts.current[sectionOf(f)];
    if (!l) return;
    const top = scrollYRef.current;
    const vh = viewportHRef.current;
    if (l.y < top + 8) scrollRef.current?.scrollTo({ y: Math.max(0, l.y - 8), animated: true });
    else if (l.y + l.h > top + vh - 8) scrollRef.current?.scrollTo({ y: l.y + l.h - vh + 8, animated: true });
  };
  // ヌルサイクル（末尾の次はフォーカスなし）＝一覧画面と同じ
  const moveFocus = (dir: 1 | -1) => {
    const i = focus === null ? -1 : focusOrder.indexOf(focus);
    let next: SheetFocus | null;
    if (dir > 0) next = i === -1 ? focusOrder[0] : i === focusOrder.length - 1 ? null : focusOrder[i + 1];
    else next = i === -1 ? focusOrder[focusOrder.length - 1] : i === 0 ? null : focusOrder[i - 1];
    setFocus(next);
    if (next) scrollIntoView(next);
  };
  // 時と分は独立して回り込む（回転式ピッカーの列と同じ＝分を回しても時は変わらない）
  const stepTime = (dir: 1 | -1, big: boolean) => {
    if (focus === 'hour') onChangeTime((hour + dir * (big ? 3 : 1) + 24) % 24, minute);
    else if (focus === 'minute') onChangeTime(hour, (minute + dir * (big ? 10 : 1) + 60) % 60);
  };
  // 時刻の数字入力（時/分にフォーカス中）。入力は常に24時間表記（下の「07 : 30」と一致させる）。
  // 1桁目で即その値になり、1.5秒以内の2桁目で2桁の値にする（2桁にすると範囲を超えるなら新しい1桁目）。
  // 時は2桁打ち終えたら（または2桁にできない 3〜9 を打ったら）分へ移る＝時にフォーカスして 0730 で 07:30。
  const digitRef = useRef<{ part: 'hour' | 'minute'; d: number; at: number } | null>(null);
  const DIGIT_JOIN_MS = 1500;
  const typeTimeDigit = (d: number) => {
    if (focus !== 'hour' && focus !== 'minute') return;
    const now = Date.now();
    const p = digitRef.current;
    const max = focus === 'hour' ? 23 : 59;
    if (p && p.part === focus && now - p.at < DIGIT_JOIN_MS && p.d * 10 + d <= max) {
      const v = p.d * 10 + d;
      digitRef.current = null;
      if (focus === 'hour') { onChangeTime(v, minute); setFocus('minute'); }
      else onChangeTime(hour, v);
      return;
    }
    if (focus === 'hour') onChangeTime(d, minute); else onChangeTime(hour, d);
    // 1桁目のままで確定する数字（時は 3〜9・分は 6〜9）は2桁目を待たない
    if (d * 10 > max) {
      digitRef.current = null;
      if (focus === 'hour') setFocus('minute');
    } else {
      digitRef.current = { part: focus, d, at: now };
    }
  };

  const shift = KeyCommand.keyModifierShift;
  const isPadDevice = (Platform as any).isPad;
  // ⚠️ シートには入力欄（ラベル）があるので矢印は iPhone のみ（iPad は H/L・J/K で操作する）。
  //    ラベルの入力中は入力欄が文字キーを受け取るので、ここの文字キーは自然と発火しない。
  useKeyCommands([
    { input: 'j', handler: () => moveFocus(1) },
    { input: 'k', handler: () => moveFocus(-1) },
    { input: 'h', handler: () => stepTime(-1, false) },
    { input: ',', handler: () => stepTime(-1, false) },
    { input: 'l', handler: () => stepTime(1, false) },
    { input: '.', handler: () => stepTime(1, false) },
    { input: 'h', modifierFlags: shift, handler: () => stepTime(-1, true) },
    { input: ',', modifierFlags: shift, handler: () => stepTime(-1, true) },
    { input: 'l', modifierFlags: shift, handler: () => stepTime(1, true) },
    { input: '.', modifierFlags: shift, handler: () => stepTime(1, true) },
    ...(isPadDevice ? [] : [
      { input: KeyCommand.keyInputDownArrow, handler: () => moveFocus(1) },
      { input: KeyCommand.keyInputUpArrow, handler: () => moveFocus(-1) },
      { input: KeyCommand.keyInputLeftArrow, handler: () => stepTime(-1, false) },
      { input: KeyCommand.keyInputRightArrow, handler: () => stepTime(1, false) },
      { input: KeyCommand.keyInputLeftArrow, modifierFlags: shift, handler: () => stepTime(-1, true) },
      { input: KeyCommand.keyInputRightArrow, modifierFlags: shift, handler: () => stepTime(1, true) },
    ]),
    // 数字：曜日にフォーカス中＝表示の並び順（左から）で 1〜7 を ON/OFF／時・分にフォーカス中＝時刻の直接入力
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ input: String(n), handler: () => {
      if (focus === 'weekdays') { if (n >= 1 && n <= 7) onToggleWeekday(n - 1); return; }
      typeTimeDigit(n);
    } })),
    { input: KeyCommand.keyInputEnter, handler: () => { if (focus === 'label') labelRef.current?.focus(); } },
    { input: ' ', handler: () => { if (focus === 'goal' && goalEnabled) onChangeOnlyIfGoalUnmet(!onlyIfGoalUnmet); } },
    { input: 's', handler: onSave },
    { input: 's', modifierFlags: KeyCommand.keyModifierCommand, handler: onSave },
    ...(isNew ? [] : deleteKeySpecs(onDelete)),
  ], visible);
  // Esc は入力中も発火する（修飾なしでも入力欄が消費しない）＝入力中ならまずカーソルを外す。
  // 次に開いている ⓘ の説明（escStack）→ シートを閉じる（従来の SettingsDetail の Esc と同じ順）。
  useKeyCommands([
    { input: KeyCommand.keyInputEscape, handler: () => {
      if (labelEditing) { labelRef.current?.blur(); return; }
      if (popEscDismiss()) return;
      onClose();
    } },
  ], visible);
  const focusRing = (on: boolean) => on ? (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: -6, bottom: -6, left: -8, right: -8, borderRadius: 8, borderWidth: 2, borderColor: theme.colors.primary }}
    />
  ) : null;

  const scrollToLabel = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
  };

  const timeDate = new Date();
  timeDate.setHours(hour, minute, 0, 0);

  useEffect(() => {
    if (visible) {
      overlayOpacity.value = withTiming(1, { duration: 200 });
      sheetY.value = withTiming(0, { duration: 250 });
    } else {
      overlayOpacity.value = withTiming(0, { duration: 200 });
      sheetY.value = withTiming(screenHeight, { duration: 250 });
    }
  }, [visible, screenHeight]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  const dayNames = getWeekdayShort(t);
  const DELETE_COLOR = theme.dark ? '#EF9A9A' : '#B71C1C';

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, overlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[sheetStyle, sheetStyles.sheet, { backgroundColor: theme.colors.surface }]}>
        {/* ヘッダー */}
        <View style={sheetStyles.sheetHeader}>
          <Text style={[sheetStyles.sheetTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {isNew ? t('notification.addSchedule') : t('notification.editSchedule')}
          </Text>
          <Pressable onPress={onClose} style={{ padding: 4 }}>
            <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
          </Pressable>
        </View>

        {/* ⚠️ **キーボードでシートを動かさない**（`KeyboardAvoidingView` は使わない）。
            シートごと持ち上げると下端固定の面が伸び縮みして目に付くので、**キーボードと
            重なったぶんだけスクロールの余白を増やし、中身のスクロールだけで欄を出す**
            （iOS のフォームと同じ挙動）。入力中は下部の ✓ がキーボードの裏に入るが、
            それはデッキ編集・カード編集と同じ（Return＝完了で閉じてから保存する）。
            ⚠️ iPad の分割表示で隣のアプリがキーボードを出したときの誤反応は、RN 本体への
            パッチ（`patches/react-native+0.81.5.patch`）がこの prop の実装内で弾いている。
            ⚠️ `keyboardShouldPersistTaps="handled"` ＝入力中でも曜日やトグルを1タップで
            操作できる（無いと最初のタップがキーボードを閉じるだけで消える）。 */}
        <ScrollView
          ref={scrollRef}
          onLayout={(e) => { viewportHRef.current = e.nativeEvent.layout.height; }}
          onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 20 }}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
        >
          {/* 時刻 */}
          <View style={{ alignItems: 'center', paddingTop: 8 }} onLayout={(e) => { sectionLayouts.current.time = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }; }}>
            {/* 053：枠はピッカー全体に付け、どちらを動かしているかは下の小さな文字で示す
                （12時間表記の言語は列が3つ＝列の位置が言語で変わるので、列の上に枠を重ねない）。 */}
            <View>
            <DateTimePicker
              value={timeDate}
              mode="time"
              display="spinner"
              onChange={(_, date) => {
                if (!date) return;
                onChangeTime(date.getHours(), date.getMinutes());
              }}
              themeVariant={theme.dark ? 'dark' : 'light'}
              style={{ width: 220 }}
            />
            {focusRing(focus === 'hour' || focus === 'minute')}
            </View>
            {/* 時刻にフォーカスしているときだけ「07 : 30」を出し、動かしている側の数字にだけ枠を付ける。
                ⚠️ 枠をピッカーの列に重ねない＝列の数・位置は 12/24 時間表記や右から左の言語で変わり、
                アプリからは分からない。自前で描く数字なら必ず正しい位置に付く。 */}
            {(focus === 'hour' || focus === 'minute') && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                {([['hour', hour], ['minute', minute]] as const).map(([part, v], i) => (
                  <View key={part} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {i === 1 && (
                      <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.lg, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>:</Text>
                    )}
                    <View
                      accessibilityLabel={t(part === 'hour' ? 'notification.timeFocusHour' : 'notification.timeFocusMinute')}
                      style={{
                        paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 2,
                        borderColor: focus === part ? theme.colors.primary : 'transparent',
                      }}
                    >
                      <Text
                        style={{ color: focus === part ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.lg, fontWeight: '700', fontVariant: ['tabular-nums'] }}
                        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                      >
                        {String(v).padStart(2, '0')}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* 曜日選択 */}
          <View style={{ gap: 8 }} onLayout={(e) => { sectionLayouts.current.weekdays = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }; }}>
            {focusRing(focus === 'weekdays')}
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('notification.weekdays')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {dayNames.map((name, i) => {
                const sel = weekdays.includes(i);
                return (
                  // 053：曜日にフォーカスしている間だけ、押す数字（1〜7・左から）を各曜日の下に出す
                  <View key={i} style={{ flex: 1, minWidth: 36, alignItems: 'stretch', gap: 4 }}>
                  <Pressable
                    onPress={() => onToggleWeekday(i)}
                    style={[
                      sheetStyles.dayBtn,
                      // 幅は外側の View が flex:1 で受け持つ（ボタン自身は縦に伸びない）
                      { flex: 0 },
                      { borderColor: sel ? theme.colors.primary : themedFrameBorder(theme) },
                      sel && { backgroundColor: theme.colors.primary },
                    ]}
                  >
                    <Text style={{ color: sel ? theme.colors.primaryText : theme.colors.textSecondary, fontSize: theme.fontSize.xs, fontWeight: sel ? '700' : '400' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {name}
                    </Text>
                  </Pressable>
                  {focus === 'weekdays' && (
                    <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.xs, fontWeight: '700', textAlign: 'center' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {i + 1}
                    </Text>
                  )}
                  </View>
                );
              })}
            </View>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
              {formatWeekdays(weekdays, dayNames, t)}
            </Text>
          </View>

          {/* ラベル */}
          <View style={{ gap: 8 }} onLayout={(e) => { sectionLayouts.current.label = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }; }}>
            {focusRing(focus === 'label')}
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('notification.label')}
            </Text>
            <TextInput
              ref={labelRef}
              value={label}
              onChangeText={onChangeLabel}
              placeholder={t('notification.labelPlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              style={[sheetStyles.labelInput, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.background, fontSize: theme.fontSize.md }]}
              maxLength={40}
              returnKeyType="done"
              onFocus={() => { setLabelEditing(true); scrollToLabel(); }}
              onBlur={() => setLabelEditing(false)}
            />
          </View>

          {/* 046: 目標が未達成のときだけ通知する。目標（設定→学習）が OFF のときは
              `scheduleGoalReminders` が1件も予約しない＝絶対に鳴らないので、操作を塞いで理由を出す。
              ⚠️ **理由の行（NoGoal）は常時表示にする**＝ⓘ の中に隠すと無効の理由が画面から消え、
              「オンに見えるのに効いていない」になる。ⓘ に入れるのは機能の説明（Hint）のほうだけ。
              ⚠️ **赤い ! はトグル ON のときだけ**＝OFF は前提を満たしていないだけで何も壊れておらず
              （使えないことは disabled ＋ opacity で伝わる）、常時赤にすると `inactiveNotice`
              （通知オフ＝全部鳴らない）の赤と意味が混ざって本物の警告の効きが落ちる。ON のときは
              「予約したのに鳴らない」＝一覧の赤バッジ（`goalBadgeNoGoal`）と同じ状態なので色も揃える。 */}
          <View style={{ gap: 6, opacity: goalEnabled ? 1 : 0.5 }} onLayout={(e) => { sectionLayouts.current.goal = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }; }}>
            {focusRing(focus === 'goal')}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {/* ⓘ は**タイトルのすぐ右**に置く（データ管理の行と同じ形）＝
                  ラベルを flex:1 で伸ばすとスイッチの隣まで飛んでいき、何の説明か分からなくなる。
                  ラベルは flexShrink:1 ＝長い訳語（es）はスイッチを押し出さずに折り返す。 */}
              <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.md, flexShrink: 1 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t('notification.onlyIfGoalUnmet')}
              </Text>
              <Pressable onPress={() => setShowInfo((v) => !v)} hitSlop={8}>
                <Ionicons
                  name={showInfo ? 'information-circle' : 'information-circle-outline'}
                  size={Math.max(theme.fontSize.lg, 20)}
                  color={theme.colors.textTertiary}
                />
              </Pressable>
              <View style={{ flex: 1 }} />
              <AppSwitch
                value={onlyIfGoalUnmet}
                onValueChange={onChangeOnlyIfGoalUnmet}
                disabled={!goalEnabled}
              />
            </View>
            {!goalEnabled && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {onlyIfGoalUnmet && (
                  <Ionicons name="alert-circle-outline" size={Math.max(theme.fontSize.md, 18)} color={theme.colors.danger} />
                )}
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs, lineHeight: 16, flex: 1 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('notification.onlyIfGoalUnmetNoGoal')}
                </Text>
              </View>
            )}
            {showInfo && (
              <View style={[styles.syncInfoBox, { backgroundColor: theme.colors.background }]}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t('notification.onlyIfGoalUnmetHint')}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>

        {/* フッター（デッキ・タグ編集画面と同スタイル） */}
        <View style={[sheetStyles.sheetFooter, { borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          {!isNew && (
            <TouchableOpacity style={[sheetStyles.actionBtn, { backgroundColor: theme.colors.danger }]} onPress={onDelete}>
              <Ionicons name="trash-outline" size={26} color="#FFF" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[sheetStyles.actionBtn, { backgroundColor: theme.colors.primary }]} onPress={onSave}>
            <Ionicons name="checkmark-sharp" size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

// ────────────────────────────────────────────────────────
// メイン画面
// ────────────────────────────────────────────────────────

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useSQLiteContext();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const { notificationEnabled, notificationHour, notificationMinute, setNotificationEnabled, studyGoalEnabled } = useSettingsStore();

  const [schedules, setSchedules] = useState<NotificationSchedule[]>([]);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  // 行の左スワイプ削除の対象 id（編集モーダル経由の削除＝showDeleteModal とは別トリガー）
  const [swipeDeleteId, setSwipeDeleteId] = useState<string | null>(null);

  // モーダル状態
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = 新規
  const [editHour, setEditHour] = useState(8);
  const [editMinute, setEditMinute] = useState(0);
  const [editWeekdays, setEditWeekdays] = useState<number[]>([]);
  const [editLabel, setEditLabel] = useState('');
  // 046: このスケジュールを「目標が未達成のときだけ」鳴らすか
  const [editOnlyIfGoalUnmet, setEditOnlyIfGoalUnmet] = useState(false);
  // OS の通知許可。null = 未確認（確認できるまで注意行を出さない）。
  // アプリ内でオンにした後に OS 設定側で取り消されると、notificationEnabled は true のまま
  // 一切鳴らなくなる＝アプリからは分からない沈黙になるので、画面を開くたびに確認する。
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);


  const loadSchedules = useCallback(async () => {
    const rows = await getAllSchedules(db);

    // 旧設定からの移行: schedules が空かつ notificationEnabled が true なら1件作成
    if (rows.length === 0 && notificationEnabled) {
      const created = await createSchedule(db, {
        hour: notificationHour, minute: notificationMinute,
        weekdays: [], label: '', enabled: true, onlyIfGoalUnmet: false,
      });
      setSchedules([created]);
      scheduleFromDb(db).catch(() => {});
    } else {
      setSchedules(rows);
    }
  }, [db, notificationEnabled, notificationHour, notificationMinute]);

  useFocusEffect(useCallback(() => {
    loadSchedules();
    // OS 設定アプリで許可を変えて戻ってきた場合も拾えるよう、フォーカスのたびに確認する
    isPermissionGranted().then(setPermissionGranted).catch(() => setPermissionGranted(null));
  }, [loadSchedules]));

  // グローバルトグル
  async function handleGlobalToggle(value: boolean) {
    if (value) {
      const granted = await requestPermission();
      setPermissionGranted(granted);   // 注意行の出し分けに反映する
      if (!granted) { setPermissionDenied(true); return; }
      setNotificationEnabled(true);
      scheduleFromDb(db).catch(() => {});
    } else {
      setNotificationEnabled(false);
      cancelAllScheduledNotifications().catch(() => {});
    }
  }

  // スケジュールが実際には鳴らない理由（null = 正常に動作する / 知らせる必要がない）。
  // 'master'     … アプリ内の大元トグルが OFF
  // 'permission' … OS 側で通知が許可されていない（アプリ内は ON のまま＝より気づきにくい）
  // 大元 OFF を優先する（OS 許可も無い場合、まず直すべきはアプリ内のトグルのため）。
  //
  // **ON のスケジュールが1つも無ければ null にする**：この注意行と淡色表示は「ON に見えるのに
  // 鳴らない」を防ぐためのもので、鳴る予定のスケジュールが1つも無ければ防ぐべき誤解が存在しない
  // （大元トグルの状態はスイッチ自体を見れば分かる）。大元 OFF のままスケジュールを ON にした
  // 瞬間に出るので、必要になった時に初めて現れる形になる。
  const hasEnabledSchedule = schedules.some((s) => s.enabled);
  const inactiveReason: 'master' | 'permission' | null =
    !hasEnabledSchedule ? null : !notificationEnabled ? 'master' : permissionGranted === false ? 'permission' : null;

  // スケジュール行の enabled トグル
  async function handleToggleEnabled(id: string, enabled: boolean) {
    await toggleScheduleEnabled(db, id, enabled);
    setSchedules((prev) => prev.map((s) => s.id === id ? { ...s, enabled } : s));
    if (notificationEnabled) scheduleFromDb(db).catch(() => {});
  }

  // スケジュール行タップ → 編集モーダルを開く
  function openEditModal(s: NotificationSchedule) {
    setEditingId(s.id);
    setEditHour(s.hour);
    setEditMinute(s.minute);
    setEditWeekdays([...s.weekdays]);
    setEditLabel(s.label);
    setEditOnlyIfGoalUnmet(s.onlyIfGoalUnmet);
    setModalVisible(true);
  }

  // 追加ボタン → 新規モーダルを開く
  async function openAddModal() {
    const cnt = await countSchedules(db);
    if (cnt >= MAX_SCHEDULES) {
      return;
    }
    setEditingId(null);
    setEditHour(8);
    setEditMinute(0);
    setEditWeekdays([]);
    setEditLabel('');
    setEditOnlyIfGoalUnmet(false);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
  }

  function toggleWeekday(day: number) {
    setEditWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  // 保存
  async function handleSave() {
    if (editingId === null) {
      // 新規作成
      const created = await createSchedule(db, {
        hour: editHour, minute: editMinute,
        weekdays: editWeekdays, label: editLabel.trim(), enabled: true,
        onlyIfGoalUnmet: editOnlyIfGoalUnmet,
      });
      setSchedules((prev) => [...prev, created].sort((a, b) => a.hour !== b.hour ? a.hour - b.hour : a.minute - b.minute));
    } else {
      // 更新
      const updated: NotificationSchedule = {
        id: editingId, hour: editHour, minute: editMinute,
        weekdays: editWeekdays, label: editLabel.trim(),
        enabled: schedules.find((s) => s.id === editingId)?.enabled ?? true,
        onlyIfGoalUnmet: editOnlyIfGoalUnmet,
      };
      await updateSchedule(db, updated);
      setSchedules((prev) => prev.map((s) => s.id === editingId ? updated : s).sort((a, b) => a.hour !== b.hour ? a.hour - b.hour : a.minute - b.minute));
    }
    closeModal();
    if (notificationEnabled) scheduleFromDb(db).catch(() => {});
  }

  // 削除ボタン → 確認モーダルを表示
  function handleDelete() {
    if (!editingId) return;
    setShowDeleteModal(true);
  }

  // 削除確認後の実行（編集モーダル経由＝editingId／スワイプ経由＝swipeDeleteId の両対応）
  async function handleDeleteConfirm() {
    const targetId = swipeDeleteId ?? editingId;
    if (!targetId) return;
    setShowDeleteModal(false);
    setSwipeDeleteId(null);
    await deleteSchedule(db, targetId);
    setSchedules((prev) => prev.filter((s) => s.id !== targetId));
    closeModal();
    if (notificationEnabled) scheduleFromDb(db).catch(() => {});
  }

  const dayNames = getWeekdayShort(t);

  const shortcutSections = [
    { title: t('shortcut.catFocus'), items: [
      { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
    ] },
    { title: t('shortcut.catAction'), items: [
      { key: 'Return', descKey: 'shortcut.settingActivateNotif' },
      { key: 'Space', descKey: 'shortcut.settingToggle' },
      { key: 'Delete', descKey: 'shortcut.deleteFocused' },
      { key: 'N', descKey: 'shortcut.addSchedule' },
    ] },
    { title: t('shortcut.catScheduleSheet'), items: [
      { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
      { key: '0–9', descKey: 'shortcut.scheduleTimeDigits' },
      { key: '1–7', descKey: 'shortcut.scheduleWeekday' },
      { key: 'Return', descKey: 'shortcut.scheduleLabel' },
      { key: 'Space', descKey: 'shortcut.settingToggle' },
      { key: 'S', descKey: 'shortcut.save' },
      { key: 'Delete', descKey: 'shortcut.deleteSchedule' },
    ] },
    { title: t('shortcut.catOther'), items: [
      { key: 'ESC', descKey: 'shortcut.esc' },
      { key: 'B', descKey: 'shortcut.back' },
      { key: '?', descKey: 'shortcut.showShortcuts' },
    ] },
  ];

  return (
    // 行スワイプ（SwipeToDeleteRow）は RNGH のため、push 画面ごとの GestureHandlerRootView が必須
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SettingsDetail
      title={t('notification.title')}
      shortcuts={shortcutSections}
      // 編集シートは自前でキー（Esc 含む）を持つ＝開いている間はこの画面のキーを手放す。
      // 削除の確認・権限の案内（アラート）は表示中にキーを独占する（054）ので、ここでは止めない・閉じない。
      suspendKeys={modalVisible}
      // N＝追加（一覧の新規＝N の流儀。上限に達していれば openAddModal が何もしない）
      extraKeys={[{ input: 'n', handler: () => void openAddModal() }]}
      onBack={() => {
        if (modalVisible) { closeModal(); return; }
        router.back();
      }}
      overlay={
        <>
          {permissionDenied && (
            <InfoModal
              visible
              title={t('notification.permissionDenied')}
              message={t('notification.permissionDeniedMessage')}
              onClose={() => setPermissionDenied(false)}
            />
          )}
          <ScheduleModal
            visible={modalVisible}
            isNew={editingId === null}
            hour={editHour}
            minute={editMinute}
            weekdays={editWeekdays}
            label={editLabel}
            theme={theme}
            bottomInset={bottomInset}
            onChangeTime={(h, m) => { setEditHour(h); setEditMinute(m); }}
            onToggleWeekday={toggleWeekday}
            onChangeLabel={setEditLabel}
            onlyIfGoalUnmet={editOnlyIfGoalUnmet}
            onChangeOnlyIfGoalUnmet={setEditOnlyIfGoalUnmet}
            goalEnabled={studyGoalEnabled}
            onSave={handleSave}
            onDelete={handleDelete}
            onClose={closeModal}
          />
          <ConfirmDeleteModal
            visible={showDeleteModal || swipeDeleteId !== null}
            message={t('notification.deleteScheduleConfirm')}
            onConfirm={handleDeleteConfirm}
            onClose={() => { setShowDeleteModal(false); setSwipeDeleteId(null); }}
          />
        </>
      }
    >
      {/* グローバルトグル */}
      {/* 053：カード全体で1つのフォーカス（枠はカードの縁）。Space＝ON/OFF、OS が未許可のときだけ
          Return＝設定アプリ（注意行のタップと同じ）。注意行に2つ目のフォーカスは作らない
          （「大元が OFF」の注意行は押せない＝止めても何も起きない）。 */}
      <SettingsFocusCard
        onToggle={() => void handleGlobalToggle(!notificationEnabled)}
        onActivate={inactiveReason === 'permission' ? () => Linking.openSettings().catch(() => {}) : undefined}
      >
        <View style={styles.notificationRow}>
          <Text style={[styles.notificationLabel, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('notification.dailyReminder')}
          </Text>
          <AppSwitch
            value={notificationEnabled}
            onValueChange={handleGlobalToggle}
          />
        </View>
        {/* 「スケジュールのトグルは ON なのに鳴らない」を防ぐ注意行。
            **状態ではなく結果を書く**（「オフです」ではなく「下のスケジュールは動作しません」）＝
            ユーザーが知りたいのは「なぜ来ないか」だから。
            大元 OFF と OS 未許可は原因が違う（後者はアプリ外なので設定アプリへ誘導する）。 */}
        {inactiveReason && (
          <Pressable
            style={[localStyles.inactiveNotice, { backgroundColor: theme.colors.background }]}
            onPress={inactiveReason === 'permission' ? () => Linking.openSettings().catch(() => {}) : undefined}
            disabled={inactiveReason !== 'permission'}
          >
            <Ionicons name="alert-circle-outline" size={Math.max(theme.fontSize.md, 18)} color={theme.colors.danger} />
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, flex: 1, lineHeight: 18 }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t(inactiveReason === 'permission' ? 'notification.inactivePermission' : 'notification.inactiveMaster')}
            </Text>
            {inactiveReason === 'permission' && (
              <Ionicons name="chevron-forward" size={theme.fontSize.md} color={theme.colors.textTertiary} />
            )}
          </Pressable>
        )}
      </SettingsFocusCard>

      {/* スケジュール一覧 */}
      <Text style={[localStyles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
        {t('notification.schedules')}
      </Text>

      {/* 鳴らない状態のときは一覧を淡くする。**操作は妨げない**（通知をオンにする前に
          スケジュールを準備できるようにするため）。opacity 0.55 はアーカイブ済みの
          デッキ/カード一覧と同じ値＝「データはあるが今は効いていない」の既存表現。 */}
      <SettingsFocusGroup style={{ opacity: inactiveReason ? 0.55 : 1 }}>
      {schedules.length === 0 ? (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm, textAlign: 'center', paddingVertical: 8 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('notification.noSchedules')}
          </Text>
        </View>
      ) : (
        schedules.map((s) => (
          // 053：Return＝編集シート／Space＝有効/無効／Delete＝削除（確認あり）
          <SettingsFocusRow
            key={s.id}
            variant="card"
            onActivate={() => openEditModal(s)}
            onToggle={() => void handleToggleEnabled(s.id, !s.enabled)}
            onDelete={() => setSwipeDeleteId(s.id)}
          >
          <SwipeToDeleteRow onDelete={() => setSwipeDeleteId(s.id)}>
          <Pressable
            onPress={() => openEditModal(s)}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: theme.colors.surface },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: s.enabled ? theme.colors.text : theme.colors.textTertiary, fontSize: theme.fontSize.xxl, fontWeight: '300', letterSpacing: 1 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {formatTime(s.hour, s.minute)}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <Text style={{ color: s.enabled ? theme.colors.textSecondary : theme.colors.textTertiary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                    {formatWeekdays(s.weekdays, dayNames, t)}
                  </Text>
                  {/* 曜日ドット（指定曜日のみ） */}
                  {s.weekdays.length > 0 && s.weekdays.length < WEEKDAY_COUNT && (
                    <View style={{ flexDirection: 'row', gap: 3 }}>
                      {Array.from({ length: WEEKDAY_COUNT }, (_, i) => (
                        <View
                          key={i}
                          style={{
                            width: 6, height: 6, borderRadius: 3,
                            backgroundColor: s.weekdays.includes(i)
                              ? (s.enabled ? theme.colors.primary : theme.colors.textTertiary)
                              : theme.colors.buttonBorder,
                          }}
                        />
                      ))}
                    </View>
                  )}
                  {/* 046: 未達成のときだけ鳴るスケジュールは一覧でも分かるようにする
                      （開かないと分からない設定＝時刻だけ見て「毎日鳴る」と誤解するため）。
                      目標が OFF のときは条件が成立しないので、その旨を添えて注意色にする。 */}
                  {s.onlyIfGoalUnmet && (
                    <View style={{
                      paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4,
                      backgroundColor: studyGoalEnabled ? theme.colors.primaryLight : theme.colors.background,
                      borderWidth: studyGoalEnabled ? 0 : StyleSheet.hairlineWidth,
                      borderColor: theme.colors.danger,
                    }}>
                      <Text
                        style={{
                          color: !s.enabled ? theme.colors.textTertiary
                            : studyGoalEnabled ? theme.colors.primary : theme.colors.danger,
                          fontSize: theme.fontSize.xs,
                          fontWeight: '700',
                        }}
                        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}
                      >
                        {t(studyGoalEnabled ? 'notification.goalBadge' : 'notification.goalBadgeNoGoal')}
                      </Text>
                    </View>
                  )}
                  {s.label !== '' && (
                    <Text style={{ color: s.enabled ? theme.colors.textSecondary : theme.colors.textTertiary, fontSize: theme.fontSize.sm }} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                      {s.label}
                    </Text>
                  )}
                </View>
              </View>
              <AppSwitch
                value={s.enabled}
                onValueChange={(v) => handleToggleEnabled(s.id, v)}
              />
            </View>
          </Pressable>
          </SwipeToDeleteRow>
          </SettingsFocusRow>
        ))
      )}

      </SettingsFocusGroup>

      {/* 追加ボタン */}
      {schedules.length < MAX_SCHEDULES && (
        <SettingsFocusRow variant="card" onActivate={() => void openAddModal()}>
        <Pressable
          onPress={openAddModal}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: theme.colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons name="add-circle-outline" size={Math.max(theme.fontSize.xl, 22)} color={theme.colors.primary} />
          <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('notification.addSchedule')}
          </Text>
        </Pressable>
        </SettingsFocusRow>
      )}
      {schedules.length >= MAX_SCHEDULES && (
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs, textAlign: 'center' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
          {t('notification.maxSchedules')}
        </Text>
      )}
    </SettingsDetail>
    </GestureHandlerRootView>
  );
}

const sheetStyles = StyleSheet.create({
  sheet: {
    // 高さの上限（キーボードとは無関係の安全弁）。時刻スピナー＋曜日＋ラベル＋トグルは
    // 文字サイズを大きくすると画面を超えうるので、上限を置いて中の ScrollView に
    // 縮んでもらう（無いとヘッダーのタイトル・✕ が画面の外へ出る）。
    maxHeight: '90%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  sheetTitle: { fontWeight: '700' },
  dayBtn: {
    flex: 1,
    minWidth: 36,
    minHeight: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
});

const localStyles = StyleSheet.create({
  inactiveNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 4 },
  sectionTitle: {
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 2,
    marginLeft: 4,
  },
});
