// 統計：草グラフをタップしたときに出る「学習の記録」ボトムシート。
// 継続・積み上げ系の指標（最長連続・総学習回数・総学習時間・経過日数）と、獲得バッジ
// （連続20＋回数/時間/日数 各10・周回込み110）を表示する。
// ドーナツグラフ側（正答率/学習日数/平均時間）と重複しない指標に絞っている。無料機能。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { FontAwesome5, Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as KeyCommand from 'react-native-key-command';

import { computeGoalDayStats } from '@/lib/studyGoal';
import { KEY_END, KEY_HOME, KEY_PAGE_DOWN, KEY_PAGE_UP, useKeyCommands } from '@/lib/useKeyCommands';
import { useSettingsStore, type RecordSheetMode } from '@/store/settings';
import { MAX_FONT_MULTIPLIER, FILTER_COLORS, themedFrameBorder, type AppTheme } from '@/lib/theme';
import { useResponsiveSize } from '@/lib/useResponsiveSize';
import { InfoModal } from '@/components/InfoModal';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import type { LifetimeStats } from '@/lib/database/reviews';
import { BADGES, BADGE_MAX_LAP, BADGE_SECTIONS, LAP_GOLD, LAP_SILVER, badgeLevel, badgeStage, badgeTotal, earnedBadgeCount } from '@/lib/stats/badges';

interface Props {
  visible: boolean;
  onClose: () => void;
  stats: LifetimeStats | null;
  theme: AppTheme;
}

// 数値ブロックの表示片。unit=true の片（h/m/%）だけ小さいフォントで描画する。
type ValueSegment = { text: string; unit?: boolean };

// 数値ブロックの表示モード（ソートトグルと同じ3アイコン切替）。回数・時間・目標に効き、日数は特別扱い。
// 型と現在値は `store/settings.ts`（AsyncStorage 永続化＝**開き直しても選択が残る**）。
const RECORD_MODES: { key: RecordSheetMode; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; labelKey: string }[] = [
  { key: 'total', icon: 'sigma', labelKey: 'stats.recordModeTotal' },
  { key: 'max', icon: 'format-vertical-align-top', labelKey: 'stats.recordModeMax' },
  { key: 'avg', icon: 'scale-balance', labelKey: 'stats.recordModeAvg' },
];

/** ローカル YYYY-MM-DD から今日までの経過日数（当日含む）。 */
function elapsedDaysSince(firstDate: string | null): number | null {
  if (!firstDate) return null;
  const [y, m, d] = firstDate.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - start) / 86400000) + 1;
}

// ショートカット一覧（? キー）の表示内容。
const RECORD_SHEET_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: 'M / ⇧M', descKey: 'shortcut.recordModeToggle' },
    { key: 'U / D', descKey: 'shortcut.scrollUpDown' },
    { key: '⇧U / ⇧D', descKey: 'shortcut.scrollTopBottom' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC', descKey: 'shortcut.esc' },
    { key: '?', descKey: 'shortcut.showShortcuts' },
  ] },
];

const IS_PAD = (Platform as any).isPad;
// 「新記録まで N 日」を表示する残り日数の上限（これ以内なら近いカウントダウンを出す）。
const RECORD_COUNTDOWN_MAX = 3;
// 5つの数値ブロックの下ラベル（「最長連続」等）の Dynamic Type 拡大上限。
// 既定の content（iPad 2.5 / iPhone 1.5）だとアクセシビリティ最大で大きすぎるため、専用に抑える。
// ここを変えるとラベルの最大サイズを調整できる（数字は allowFontScaling={false} で固定・別管理）。
const RECORD_LABEL_MAX_FONT = IS_PAD ? 2 : 1.3;
// 目標達成の数値ブロックの色。**学習タブ/学習画面の旗と同じ緑**（`FILTER_COLORS.learned` 系）＝
// アプリ全体で「達成」を表す色から目標だけ外さない。右列の「日数」と同色だが、達成日は
// 学習日の部分集合で同族の指標なので、同じ色であることが包含関係の手掛かりになる。
const GOAL_COLOR = '#43A047';

export function LearningRecordSheet({ visible, onClose, stats, theme }: Props) {
  const rs = useResponsiveSize();
  const { t } = useTranslation();
  const keyboardShortcutsEnabled = useSettingsStore((s) => s.keyboardShortcutsEnabled);
  const badgeLapStageSeen = useSettingsStore((s) => s.badgeLapStageSeen);
  const setBadgeLapStageSeen = useSettingsStore((s) => s.setBadgeLapStageSeen);
  const studyGoalEnabled = useSettingsStore((s) => s.studyGoalEnabled);
  const studyGoalCount = useSettingsStore((s) => s.studyGoalCount);
  const { height: screenHeight } = useWindowDimensions();
  const sheetY = useSharedValue(screenHeight);
  const overlayOpacity = useSharedValue(0);

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

  // トータル/最高/平均トグル。**選択は永続化するので開き直しても残る**（他の一覧のソート・
  // フィルターと同じ流儀。既定はトータル）。
  const mode = useSettingsStore((s) => s.recordSheetMode);
  const setMode = useSettingsStore((s) => s.setRecordSheetMode);
  // 表示モードの説明モーダル（iアイコン）。シートを閉じたら一緒に閉じる。
  const [showModeInfo, setShowModeInfo] = useState(false);
  // ショートカット一覧（? キー）。シートを閉じたら一緒に閉じる。
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  // 周回の段階開放（分母 50→80→110）の案内。シートを閉じたら一緒に閉じる。
  const [showUnlockInfo, setShowUnlockInfo] = useState(false);
  // 閉じたら上に載っていたモーダルを畳む（表示モードは永続化するのでここでは触らない）。
  useEffect(() => { if (!visible) { setShowModeInfo(false); setShowShortcutsModal(false); setShowUnlockInfo(false); } }, [visible]);

  // 画面スクロール（U/D・PgUp/PgDn＝段階、⇧U/⇧D・Home/End＝最上部/最下部）用。
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const SCROLL_STEP = 240;
  const scrollBy = (delta: number) =>
    scrollRef.current?.scrollTo({ y: Math.max(0, scrollYRef.current + delta), animated: true });
  const scrollToTop = () => scrollRef.current?.scrollTo({ y: 0, animated: true });
  const scrollToBottom = () => scrollRef.current?.scrollToEnd({ animated: true });
  // M：表示モード（トータル→最高→平均）を循環。⇧M で逆順。
  // ⚠️ **現在値はストアから読む**（`useState` の関数更新が使えないうえ、キーコマンドの
  //    ハンドラは登録時のクロージャなので、render 時の `mode` を参照すると stale になる）。
  const cycleMode = (dir = 1) => {
    const cur = useSettingsStore.getState().recordSheetMode;
    const n = RECORD_MODES.length;
    const i = RECORD_MODES.findIndex((m) => m.key === cur);
    setMode(RECORD_MODES[(i + dir + n) % n].key);
  };

  // Space / Return でシートを閉じる（ドーナツシートと同じトグル挙動）。表示中のみ有効。
  // 説明モーダル（i アイコン）／ショートカット一覧表示中は解除する。
  // Esc は親 stats の常時 Esc ハンドラが閉じる（月別シートと同じ方式・二重登録を避ける）。
  // M＝モード切替、U/D・PgUp/PgDn＝段階スクロール、⇧U/⇧D・Home/End＝最上部/最下部、?＝一覧。
  useKeyCommands([
    { input: ' ', handler: onClose },
    { input: KeyCommand.constants.keyInputEnter as string, handler: onClose },
    { input: 'm', handler: () => cycleMode(1) },
    { input: 'm', modifierFlags: KeyCommand.constants.keyModifierShift, handler: () => cycleMode(-1) },
    { input: 'u', handler: () => scrollBy(-SCROLL_STEP) },
    { input: 'd', handler: () => scrollBy(SCROLL_STEP) },
    { input: KEY_PAGE_UP, handler: () => scrollBy(-SCROLL_STEP) },
    { input: KEY_PAGE_DOWN, handler: () => scrollBy(SCROLL_STEP) },
    { input: 'u', modifierFlags: KeyCommand.constants.keyModifierShift, handler: scrollToTop },
    { input: 'd', modifierFlags: KeyCommand.constants.keyModifierShift, handler: scrollToBottom },
    { input: KEY_HOME, handler: scrollToTop },
    { input: KEY_END, handler: scrollToBottom },
    // ?（Shift+/）でショートカット一覧を開く。閉じるは一覧側の ? が担当（一覧表示中は下の gate で解除）。
    { input: '/', modifierFlags: KeyCommand.constants.keyModifierShift, handler: () => setShowShortcutsModal(true) },
  ], visible && !showModeInfo && !showShortcutsModal && !showUnlockInfo);

  // 数値＋単位を片に分解する（単位は unit:true）。h があるときのみ h を出す（従来の 1h23m / 45m を踏襲）。
  function formatDuration(ms: number): ValueSegment[] {
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const segs: ValueSegment[] = [];
    if (h > 0) segs.push({ text: String(h) }, { text: t('stats.durationUnitH'), unit: true });
    segs.push({ text: String(m) }, { text: t('stats.durationUnitM'), unit: true });
    return segs;
  }
  const plain = (text: string): ValueSegment[] => [{ text }];

  // モード切替ボタンの非選択枠・未達成バッジの丸枠に使うテーマ追従の枠線色。
  const frameBorder = themedFrameBorder(theme);

  const elapsed = stats ? elapsedDaysSince(stats.firstDate) : null;
  const earned = stats ? earnedBadgeCount(stats) : 0;
  // 周回の段階開放：分母は 50→（どれかが2周目に入ると）80→（3周目で）110。
  const stage = stats ? badgeStage(stats) : 1;
  const total = badgeTotal(stage);

  // 段階を初めて跨いだときに一度だけ案内を出す（獲得自体は学習中に起きるため、
  // シートを開いたときの検出方式。表示と同時に既読段階を保存する）。
  useEffect(() => {
    if (visible && stats && stage > badgeLapStageSeen) {
      setShowUnlockInfo(true);
      setBadgeLapStageSeen(stage);
    }
  }, [visible, stats, stage, badgeLapStageSeen, setBadgeLapStageSeen]);
  // 最長連続セル内のバッジ：現在の連続（今日起点。今日未学習なら 0）と、進行中を除く自己ベスト prevBestStreak
  // の関係で 4 状態を出し分ける。もうすぐ→タイ→達成→更新中 と日ごとに変化する。
  const recordPill = ((): { icon: React.ComponentProps<typeof Ionicons>['name']; iconColor: string; text: string } | null => {
    if (!stats || stats.currentStreak <= 0) return null;
    const cur = stats.currentStreak;
    const prev = stats.prevBestStreak;
    if (cur > prev + 1) return { icon: 'flame', iconColor: '#FFD54F', text: t('stats.recordStreakUpdating') };
    if (cur === prev + 1) return { icon: 'trophy', iconColor: '#FFD54F', text: t('stats.recordStreakNewBest') };
    if (cur === prev) return { icon: 'flame-outline', iconColor: '#FFD54F', text: t('stats.recordStreakTie') };
    const days = prev - cur + 1; // 記録を「抜く」のに必要な残り日数
    if (days <= RECORD_COUNTDOWN_MAX) return { icon: 'flag', iconColor: '#fff', text: t('stats.recordStreakCountdown', { days }) };
    return null;
  })();

  // 左列：最長連続（大・プライマリ背景）＋目標達成（下・目標 ON のときだけ）。
  // 右列：総学習回数・総学習時間・総学習日数の3つ。
  const streakBlock = stats
    ? { value: String(stats.longestStreak), label: t('stats.recordLongestStreak'), color: '#F4511E' }
    : null;
  // 046 Phase 5：目標達成の集計。**現在の目標枚数で過去も判定する**ので、目標を変えると
  // 値も変わる（クエリの再実行は不要＝`dailyCounts` から計算し直すだけ）。
  const goalStats = useMemo(
    () => (stats ? computeGoalDayStats(stats.dailyCounts, studyGoalCount) : null),
    [stats, studyGoalCount]
  );
  // 回数=青／時間=オレンジ（フィルター「復習」色）／日数=緑。モードで値とラベルを切り替える。
  // 平均は「1日あたり」＝学習日数で割る（回数・時間）。日数は継続率＝学習日数÷経過日数（%）。
  const REVIEW_COLOR = '#1976D2';
  const DAYS_COLOR = '#43A047';
  const avgReviews = stats && stats.totalDays > 0 ? stats.totalReviews / stats.totalDays : 0;
  const avgTimeMs = stats && stats.totalDays > 0 ? stats.totalTimeMs / stats.totalDays : 0;
  const continuityPct = stats && elapsed != null && elapsed > 0 ? Math.min(100, Math.round((stats.totalDays / elapsed) * 100)) : null;
  // ⚠️ **ラベルは短い語にしてある**（「回数」「回数/日」）＝どのモードかは**小見出し**が示す。
  //    トグルはアイコンだけなので、モードを表す言葉は小見出しにしか無い。
  // ⚠️ `descKey` はラベルの**すぐ隣**に置く＝ⓘ の説明は画面に出ている4ブロックから組むので、
  //    片方だけ直して説明と表示が食い違うことがない。
  const rightBlocks: { segments: ValueSegment[]; label: string; color: string; descKey: string }[] = !stats
    ? []
    : mode === 'max'
    ? [
        { segments: plain(stats.maxDailyReviews.toLocaleString()), label: t('stats.recordMaxReviews'), color: REVIEW_COLOR, descKey: 'stats.recordDescMaxReviews' },
        { segments: formatDuration(stats.maxDailyTimeMs), label: t('stats.recordMaxTime'), color: FILTER_COLORS.due, descKey: 'stats.recordDescMaxTime' },
        // 日数の「最高」は暦月ごとの最高学習日数（1日の最高＝常に1で無意味なため月単位に）。
        { segments: plain(stats.maxMonthlyDays.toLocaleString()), label: t('stats.recordMaxMonthlyDays'), color: DAYS_COLOR, descKey: 'stats.recordDescMaxMonthlyDays' },
      ]
    : mode === 'avg'
    ? [
        { segments: plain(avgReviews.toFixed(1)), label: t('stats.recordAvgReviews'), color: REVIEW_COLOR, descKey: 'stats.recordDescAvgReviews' },
        { segments: formatDuration(avgTimeMs), label: t('stats.recordAvgTime'), color: FILTER_COLORS.due, descKey: 'stats.recordDescAvgTime' },
        { segments: continuityPct != null ? [{ text: String(continuityPct) }, { text: '%', unit: true }] : plain('-'), label: t('stats.recordContinuity'), color: DAYS_COLOR, descKey: 'stats.recordDescContinuity' },
      ]
    : [
        { segments: plain(stats.totalReviews.toLocaleString()), label: t('stats.recordTotalReviews'), color: REVIEW_COLOR, descKey: 'stats.recordDescTotalReviews' },
        { segments: formatDuration(stats.totalTimeMs), label: t('stats.recordTotalTime'), color: FILTER_COLORS.due, descKey: 'stats.recordDescTotalTime' },
        { segments: plain(stats.totalDays.toLocaleString()), label: t('stats.recordTotalDays'), color: DAYS_COLOR, descKey: 'stats.recordDescTotalDays' },
      ];
  // 目標達成（4軸目）。右列と同じモードに追従する（Σ=達成日数／最高=最長連続達成／平均=達成率）。
  const goalBlock = !stats || !goalStats || !studyGoalEnabled
    ? null
    : mode === 'max'
    ? { segments: plain(goalStats.longestAchievedStreak.toLocaleString()), label: t('stats.recordGoalMaxStreak'), color: GOAL_COLOR, descKey: 'stats.recordDescGoalMaxStreak' }
    : mode === 'avg'
    ? {
        segments: goalStats.achievementRate != null
          ? [{ text: String(goalStats.achievementRate) }, { text: '%', unit: true }]
          : plain('-'),
        label: t('stats.recordGoalRate'),
        color: GOAL_COLOR,
        descKey: 'stats.recordDescGoalRate',
      }
    : { segments: plain(goalStats.achievedDays.toLocaleString()), label: t('stats.recordGoalDays'), color: GOAL_COLOR, descKey: 'stats.recordDescGoalDays' };
  // 左下のセル：目標 ON なら目標達成、OFF なら開始からの日数（＝046 以前とまったく同じ見た目）。
  // ⚠️ **左列は常に2セルに保つ**：OFF のとき1セルにすると streakCell の `flexGrow` で
  // 右列3セル分の高さに伸び、実機で数字が間延びして見えた（Y案を実機確認して差し戻し）。
  // 開始からの日数は目標 ON のときだけグリッドの下のキャプション行へ移る。経緯は `docs/046` Phase 5。
  const leftBottomBlock = goalBlock ?? (stats
    ? {
        segments: plain(elapsed != null ? String(elapsed) : '-'),
        label: t('stats.recordElapsed'),
        color: theme.colors.textSecondary,
        descKey: 'stats.recordDescElapsed',
      }
    : null);

  // 小見出し（＝いまのモード名）と、ⓘ に出す説明の行。**画面に出ているブロックそのもの**から
  // 組むので、モードを変えれば説明も一緒に入れ替わる。左下セル（目標／開始からの日数）も含める。
  const activeModeLabel = t(RECORD_MODES.find((m) => m.key === mode)?.labelKey ?? 'stats.recordModeTotal');
  const modeInfoRows = [...rightBlocks, ...(leftBottomBlock ? [leftBottomBlock] : [])];

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, overlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[sheetStyle, styles.sheet, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { backgroundColor: theme.colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16 }]}>
          {/* 設定 ON のときはタイトル横にキーボードアイコンを出し、タップでショートカット一覧を開く（他画面と統一）。 */}
          <Pressable
            onPress={keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg, flexShrink: 1 }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('stats.recordTitle')}
            </Text>
            {keyboardShortcutsEnabled && (
              <MaterialIcons name="keyboard" size={20} color={theme.colors.primary} />
            )}
          </Pressable>
        </View>
        <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
          <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
        </Pressable>

        <ScrollView
          ref={scrollRef}
          onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          {/* 見出し（左）＋表示モード切替（ソートトグルと同じ3アイコン・右）。ⓘ は下の小見出し側。 */}
          {stats && (
            <View style={styles.toggleRow}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md, flexShrink: 1 }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('stats.recordSummaryTitle')}
              </Text>
              <View style={styles.modeButtons}>
                {RECORD_MODES.map(({ key, icon, labelKey }) => {
                  const active = mode === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setMode(key)}
                      accessibilityLabel={t(labelKey)}
                      style={[
                        styles.modeBtn,
                        { borderColor: active ? theme.colors.primary : frameBorder, paddingHorizontal: rs(10, 32) },
                        active && { backgroundColor: theme.colors.primary },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={icon}
                        size={Math.max(theme.fontSize.xl, rs(20, 22))}
                        color={active ? theme.colors.primaryText : theme.colors.textSecondary}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          {/* 小見出し＝**いまのモード名**（合計／最高・最長／平均・比率）。トグルはアイコンだけなので、
              何を見ているのかを言葉で示すのはこの行だけ（ラベルを短くしたぶんの受け皿でもある）。
              ⓘ はこのモードの4ブロックの説明を出す＝表示中のものだけを説明するので読む量が少ない。 */}
          {stats && (
            <Pressable style={styles.modeHeadingRow} onPress={() => setShowModeInfo(true)} hitSlop={6}>
              <Text
                style={[styles.modeHeading, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {activeModeLabel}
              </Text>
              <Ionicons name="information-circle-outline" size={Math.max(theme.fontSize.md, 18)} color={theme.colors.textTertiary} />
            </Pressable>
          )}

          {/* 上部の数値ブロック：左列（最長連続・大＋目標達成）／右列（3つ縦積み） */}
          {stats && streakBlock && (
            <View style={styles.numberRow}>
              <View style={styles.leftColumn}>
                <View style={[styles.streakCell, { backgroundColor: theme.colors.primary }]}>
                  {recordPill && (
                    <View style={styles.recordPill}>
                      <Ionicons name={recordPill.icon} size={Math.max(theme.fontSize.xs, 12)} color={recordPill.iconColor} />
                      <Text style={[styles.recordPillText, { color: '#fff', fontSize: theme.fontSize.xs }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                        {recordPill.text}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.numberValue, { color: '#fff', fontSize: theme.fontSize.xxl * (IS_PAD ? 2.3 : 1.6) }]} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
                    {streakBlock.value}
                  </Text>
                  <Text style={[styles.numberLabel, { color: 'rgba(255,255,255,0.85)', fontSize: theme.fontSize.xs }]} numberOfLines={1} maxFontSizeMultiplier={RECORD_LABEL_MAX_FONT}>
                    {streakBlock.label}
                  </Text>
                </View>
                {leftBottomBlock && (
                  <View style={[styles.numberCell, { backgroundColor: theme.colors.surface }]}>
                    <Text style={[styles.numberValue, { color: leftBottomBlock.color, fontSize: theme.fontSize.xxl * (IS_PAD ? 1.5 : 1.1) }]} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
                      {leftBottomBlock.segments.map((s, si) => (
                        <Text key={si} style={s.unit ? { fontSize: theme.fontSize.md, fontWeight: '600' } : undefined}>
                          {s.text}
                        </Text>
                      ))}
                    </Text>
                    <Text style={[styles.numberLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} numberOfLines={1} maxFontSizeMultiplier={RECORD_LABEL_MAX_FONT}>
                      {leftBottomBlock.label}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.rightColumn}>
                {rightBlocks.map((b, i) => (
                  <View key={i} style={[styles.numberCell, { backgroundColor: theme.colors.surface }]}>
                    <Text style={[styles.numberValue, { color: b.color, fontSize: theme.fontSize.xxl * (IS_PAD ? 1.5 : 1.1) }]} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
                      {b.segments.map((s, si) => (
                        // 単位（h/m/%）は数値より一段小さく（md）・やや細く描画する。色は継承。
                        <Text key={si} style={s.unit ? { fontSize: theme.fontSize.md, fontWeight: '600' } : undefined}>
                          {s.text}
                        </Text>
                      ))}
                    </Text>
                    <Text style={[styles.numberLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} numberOfLines={1} maxFontSizeMultiplier={RECORD_LABEL_MAX_FONT}>
                      {b.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 開始からの日数。**目標 ON のときだけ**ここに出る（左下のセルを目標達成に明け渡すため）。
              数値セルではなくキャプション行にするのは、他の5つが「積み上げた成果」なのに対し
              これは何もしなくても増える経過だから（グリッド＝成果／行＝文脈）。
              「学習継続率」の分母でもあるので、説明の近くに置く意味もある。未学習なら出さない。 */}
          {stats && studyGoalEnabled && elapsed != null && (
            <Text
              style={[styles.elapsedLine, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t('stats.recordElapsedLine', { days: elapsed })}
            </Text>
          )}

          {/* バッジ */}
          <View style={styles.badgeHeaderRow}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('stats.badges')}
            </Text>
            <Text style={[{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('stats.badgeEarnedCount', { earned, total })}
            </Text>
          </View>

          {BADGE_SECTIONS.map((sec) => {
            const secBadges = BADGES.filter((b) => b.kind === sec.kind);
            const isStreakSec = sec.kind === 'streak';
            // 連続日数は未獲得を表示しない（白丸を出さず、獲得したメダルだけ並べる）。
            // 他カテゴリは前半5個のみ表示し、前半を完集（5個目獲得）した時点で後半5個が
            // 空き枠として現れる（達成＋次の目標の開示が同時に起きる）。
            const earnedInSec = stats ? secBadges.filter((b) => badgeLevel(b, stats) > 0).length : 0;
            const visibleBadges = isStreakSec
              ? secBadges.filter((b) => (stats ? badgeLevel(b, stats) > 0 : false))
              : earnedInSec >= 5 ? secBadges : secBadges.slice(0, 5);
            // 見出しの周回表示（2周目から）。現在周回＝最終バッジの獲得周回＋1（全周完了後は3のまま）。
            const lap = !isStreakSec && stats
              ? Math.min(badgeLevel(secBadges[secBadges.length - 1], stats) + 1, BADGE_MAX_LAP)
              : 1;
            return (
            <View key={sec.kind} style={styles.badgeSection}>
              <Text style={[styles.badgeSectionLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {t(sec.labelKey)}{lap >= 2 ? t('stats.badgeSectionLap', { lap }) : ''}
              </Text>
              <View style={[styles.badgeGrid, IS_PAD && { gap: 16 }]}>
                {visibleBadges.map((b) => {
                  const level = stats ? badgeLevel(b, stats) : 0;
                  const got = level > 0;
                  const isStreak = b.kind === 'streak';
                  // 連続：獲得＝プライマリ背景の丸＋メダル色アイコン＋日数（未獲得は上の filter で除外済み）。
                  // その他：最初から薄いグレーのアイコン＋文字（獲得で色付き）。周回昇格は連続メダルと
                  // 同じ視覚言語＝2周目からカテゴリ色のべた塗り背景＋銀（2周目）/金（3周目）アイコン。
                  const showIcon = isStreak ? got : true;
                  const iconColor = isStreak ? b.color
                    : level >= 3 ? LAP_GOLD
                    : level === 2 ? LAP_SILVER
                    : got ? b.color : theme.colors.iconSubtle;
                  const circleStyle = isStreak
                    ? got
                      ? { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary }
                      : { borderColor: theme.colors.inputBorder, backgroundColor: 'transparent' }
                    : level >= 2
                      ? { borderColor: b.color, backgroundColor: b.color }
                      : got
                        ? { borderColor: b.color, backgroundColor: b.color + '22' }
                        : { borderColor: frameBorder, backgroundColor: 'transparent' };
                  const labelHidden = isStreak && !got;
                  return (
                    <View key={b.id} style={[styles.badgeCell, IS_PAD && { width: 76 }]}>
                      <View style={[styles.badgeIconWrap, circleStyle, !got && { opacity: isStreak ? 1 : 0.6 }]}>
                        {showIcon ? (
                          b.iconSet === 'ionicons' ? (
                            <Ionicons name={b.icon as keyof typeof Ionicons.glyphMap} size={20} color={iconColor} />
                          ) : (
                            <FontAwesome5 name={b.icon as keyof typeof FontAwesome5.glyphMap} size={18} color={iconColor} solid />
                          )
                        ) : null}
                      </View>
                      <Text
                        style={[styles.badgeShort, { color: labelHidden ? 'transparent' : got ? theme.colors.text : theme.colors.textTertiary, fontSize: theme.fontSize.xs }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                      >
                        {labelHidden ? ' ' : b.short}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
            );
          })}
        </ScrollView>
      </Animated.View>

      {/* いまのモードの数値ブロックの説明（小見出しの ⓘ）。**表示中の4ブロックだけ**を、
          画面と同じラベル・同じ並びで説明する（3モード全部を並べると読む量が増えるうえ、
          いま見ていないものの説明が混ざる）。 */}
      <InfoModal
        visible={showModeInfo}
        title={activeModeLabel}
        message={
          <View>
            {modeInfoRows.map(({ label, descKey }) => (
              <Text
                key={descKey}
                style={{ color: theme.colors.text, fontSize: theme.fontSize.md, lineHeight: 24 }}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {/* ラベルと説明のつなぎ（「：」/「: 」）は言語で変わるので翻訳キーに置く */}
                {t('stats.recordInfoLine', { label, desc: t(descKey) })}
              </Text>
            ))}
            {/* 平均・比率のときだけ、**2つの分母を並べて**添える。⚠️ 継続率だけ分母が違う
                （学習日数 ÷ 経過日数）ので、行を短くするなら分母はここで示すしかない
                ＝どこにも書かないと「学習した日のうち…」と読まれて逆の意味になる。 */}
            {mode === 'avg' && (
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20, marginTop: 8 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('stats.recordModeAvgScopeNote')}
              </Text>
            )}
            {/* 目標を使っている人にだけ、判定の基準（現在の目標枚数）を添える。 */}
            {studyGoalEnabled && (
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20, marginTop: 8 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('stats.recordModeGoalNote', { count: studyGoalCount })}
              </Text>
            )}
          </View>
        }
        onClose={() => setShowModeInfo(false)}
      />

      {/* 周回の段階開放の案内（分母 50→80→110 を初めて跨いだときに一度だけ） */}
      <InfoModal
        visible={showUnlockInfo}
        title={t('stats.badgeUnlockTitle')}
        message={t('stats.badgeUnlockMessage')}
        onClose={() => setShowUnlockInfo(false)}
      />

      {/* ショートカット一覧（? キー）。閉じる/トグルは一覧本体の ? が担当。 */}
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        sections={RECORD_SHEET_SHORTCUT_SECTIONS.map((s) => ({ title: t(s.titleKey), items: s.items }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 24, maxHeight: '80%' },
  header: { alignItems: 'center', paddingHorizontal: 48, paddingVertical: 14 },
  title: { fontWeight: '700', textAlign: 'center' },
  closeBtn: { position: 'absolute', top: 14, right: 16, zIndex: 1, padding: 4 },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12, marginBottom: 4 },
  // 小見出し（モード名＋ⓘ）。**alignSelf: 'flex-start'** ＝行いっぱいに広げない（右のトグルの
  // 真下まで伸ばすと、トグルを狙ったつもりのタップで説明が開く）。
  modeHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: 10 },
  modeHeading: { fontWeight: '600' },
  modeButtons: { flexDirection: 'row', gap: 6 },
  modeBtn: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  numberRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  leftColumn: { flex: 1, gap: 8 },
  rightColumn: { flex: 1, gap: 8 },
  streakCell: { flexGrow: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', gap: 4 },
  recordPill: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.22)' },
  recordPillText: { fontWeight: '700' },
  numberCell: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', gap: 4 },
  numberValue: { fontWeight: '700' },
  numberLabel: { textAlign: 'center' },
  elapsedLine: { marginTop: 10 },
  badgeHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 20, marginBottom: 4 },
  sectionTitle: { fontWeight: '700' },
  badgeSection: { marginTop: 12 },
  badgeSectionLabel: { fontWeight: '600', marginBottom: 6 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badgeCell: { alignItems: 'center', width: 52, gap: 3 },
  badgeIconWrap: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  badgeShort: { fontWeight: '600' },
});
