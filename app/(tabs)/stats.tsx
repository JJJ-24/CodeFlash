import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';

import { DONUT_CX, DONUT_CY, DONUT_INNER_R, DONUT_R, DONUT_SIZE, donutArcPath } from '@/lib/donut';
import { useTheme, type AppTheme, FILTER_COLORS, GRADE_COLORS, MAX_FONT_MULTIPLIER, SHADOW, fontSizeForDigits } from '@/lib/theme';
import { useSettingsStore, GRADE_RANKING_PERIOD_DAYS } from '@/store/settings';
import type { InitialFilterPreference, GradeRankingPeriod } from '@/store/settings';
import { getAllDecks } from '@/lib/database/decks';
import {
  getAllGradeDistribution,
  getDailyReviewCounts,
  getDeckGradeDistribution,
  getDeckMasteryList,
  getGradeLogTotals,
  getLearnedUnlearnedCount,
  getMonthlyReviewCounts,
  getPast7DaysReviewedCount,
  getPast7DaysStudyActivity,
  getStudyStreak,
  getTodayDueCount,
  getTodayReviewedCount,
  getGradeAvgResponseTimes,
  getTopCardsByGrade,
  getUpcomingSchedule,
} from '@/lib/database/reviews';
import ActivityHeatmap from '@/components/stats/ActivityHeatmap';
import { CardStatsSheet } from '@/components/stats/CardStatsSheet';
import { HiddenKeyboardInput } from '@/components/HiddenKeyboardInput';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { useShortcutsHeader } from '@/hooks/useShortcutsHeader';
import { EmptyState } from '@/components/EmptyState';
import { getCardPreview } from '@/lib/cardPreview';
import { getPast7DaysCreatedCount, getTodayCreatedCount } from '@/lib/database/cards';
import { useProStore } from '@/store/pro';
import { useSyncStore } from '@/store/sync';
import type { Block, Deck } from '@/types';

const STATS_SHORTCUT_SECTIONS = [
  {
    titleKey: 'shortcut.sectionCommon',
    items: [
      { key: '1–4',   descKey: 'shortcut.cycleChart' },
      { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
      { key: 'Space', descKey: 'shortcut.openChart' },
      { key: ', / .', descKey: 'shortcut.tabNextPrev' },
    ],
  },
  {
    titleKey: 'shortcut.sectionGradeRanking',
    items: [
      { key: '6-9',   descKey: 'shortcut.switchGrade', pro: true },
      { key: 'D',     descKey: 'shortcut.selectDeck', pro: true },
      { key: 'T',     descKey: 'shortcut.selectPeriod', pro: true },
      { key: 'M',     descKey: 'shortcut.toggleCountTime', pro: true },
      { key: 'Space', descKey: 'shortcut.startFocusedReview', pro: true },
      { key: 'P',     descKey: 'shortcut.editFocusedItem', pro: true },
      { key: 'A',     descKey: 'shortcut.toggleCardStats', pro: true },
    ],
  },
];

const HEATMAP_WEEKS = 52; // 約1年分
const DAY_LABELS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BAR_MAX_HEIGHT = 60;
const EASE_MIN = 1.3;
const EASE_MAX = 3.0;

type MedalInfo = { name: 'trophy' | 'ribbon' | 'diamond'; color: string } | null;
function getStreakMedal(streak: number): MedalInfo {
  if (streak >= 1000) return { name: 'diamond',  color: '#000000' };
  if (streak >= 730) return { name: 'diamond',  color: '#FFD700' };
  if (streak >= 500) return { name: 'diamond',  color: '#ff9ff9' };
  if (streak >= 365) return { name: 'diamond',  color: '#00BCD4' };
  if (streak >= 300) return { name: 'trophy',   color: '#FFD700' };
  if (streak >= 200) return { name: 'trophy',   color: '#C0C0C0' };
  if (streak >= 100) return { name: 'trophy',   color: '#CD7F32' };
  if (streak >= 30)  return { name: 'ribbon',   color: '#FFD700' };
  if (streak >= 10)  return { name: 'ribbon',   color: '#C0C0C0' };
  if (streak >= 3)   return { name: 'ribbon',   color: '#CD7F32' };
  return null;
}

function masteryPercent(avgEase: number | null): number {
  if (avgEase == null) return 0;
  return Math.min(100, Math.round(((avgEase - EASE_MIN) / (EASE_MAX - EASE_MIN)) * 100));
}

function masteryColor(pct: number): string {
  if (pct >= 90) return '#1976D2';
  if (pct >= 70) return FILTER_COLORS.learned;
  if (pct >= 40) return '#FF9800';
  return '#E53935';
}

type ScheduleItem = { date: string; count: number };
type MasteryItem = { deckId: string; avgEase: number | null; learnedCount: number; newCount: number };
type GradeCard = { cardId: string; deckId: string; deckName: string; frontContent: string; gradeCount: number; avgResponseTimeMs: number | null };
type GradeTotals = { again: number; hard: number; good: number; easy: number };
type GradeAvgTimes = { again: number | null; hard: number | null; good: number | null; easy: number | null };
type BlockKey = 'streak' | 'learned' | 'due' | 'new';
type GradeDistribution = { again: number; hard: number; normal: number; easy: number; unlearned: number };

// DB から一括取得する統計データ
interface StatsData {
  todayReviewed: number;
  todayDue: number;
  streak: number;
  learned: number;
  unlearned: number;
  todayCreated: number;
  schedule: ScheduleItem[];
  past7DaysReviewed: ScheduleItem[];
  past7DaysActivity: ScheduleItem[];
  past7DaysCreated: ScheduleItem[];
  deckMastery: MasteryItem[];
  decks: Deck[];
  heatmapData: { date: string; count: number }[];
  gradeTotals: GradeTotals;
  gradeAvgTimes: GradeAvgTimes;
  monthlyReviewed: { month: string; count: number }[];
}

const INITIAL_STATS: StatsData = {
  todayReviewed: 0,
  todayDue: 0,
  streak: 0,
  learned: 0,
  unlearned: 0,
  todayCreated: 0,
  schedule: [],
  past7DaysReviewed: [],
  past7DaysActivity: [],
  past7DaysCreated: [],
  deckMastery: [],
  decks: [],
  heatmapData: [],
  gradeTotals: { again: 0, hard: 0, good: 0, easy: 0 },
  gradeAvgTimes: { again: null, hard: null, good: null, easy: null },
  monthlyReviewed: [],
};

// ──────────────────────────────────────────────
// SVG Donut Chart
// ──────────────────────────────────────────────
type PieSlice = { value: number; color: string; label: string };

function GradeDistPieChart({ dist, theme }: { dist: GradeDistribution; theme: AppTheme }) {
  const { t } = useTranslation();
  const { width: screenWidth } = useWindowDimensions();
  const total = dist.again + dist.hard + dist.normal + dist.easy + dist.unlearned;
  if (total === 0) return null;

  const learned = dist.again + dist.hard + dist.normal + dist.easy;
  const pct = total > 0 ? Math.round((learned / total) * 100) : 0;

  // 凡例用（新規未習→再度→難しい→普通→簡単 の順）
  const slices: PieSlice[] = [
    ...(dist.unlearned > 0 ? [{ value: dist.unlearned, color: '#9E9E9E', label: t('common.new') }] : []),
    { value: dist.again,     color: GRADE_COLORS.again, label: t('grade.again') },
    { value: dist.hard,      color: GRADE_COLORS.hard,  label: t('grade.hard') },
    { value: dist.normal,    color: GRADE_COLORS.good,  label: t('grade.good') },
    { value: dist.easy,      color: GRADE_COLORS.easy,  label: t('grade.easy') },
  ];
  // チャート描画用（12時から時計回りに 簡単→普通→難しい→再度→新規）
  const chartSlices: PieSlice[] = [
    { value: dist.easy,      color: GRADE_COLORS.easy,  label: t('grade.easy') },
    { value: dist.normal,    color: GRADE_COLORS.good,  label: t('grade.good') },
    { value: dist.hard,      color: GRADE_COLORS.hard,  label: t('grade.hard') },
    { value: dist.again,     color: GRADE_COLORS.again, label: t('grade.again') },
    { value: dist.unlearned, color: '#9E9E9E',           label: t('common.new') },
  ];

  const maxCountDigits = Math.max(...slices.map(s => String(s.value).length));
  const gradeCountScale = (Platform as any).isPad
    ? (maxCountDigits >= 5 ? 1.0 : maxCountDigits >= 4 ? 1.2 : maxCountDigits >= 3 ? 1.3 : 1.3)
    : (maxCountDigits >= 3 ? 1.3 : 1.0);
  const gradeCountFontSize = fontSizeForDigits(theme, (Platform as any).isPad ? 1 : maxCountDigits, gradeCountScale);
  const maxLabelLen = Math.max(...slices.map(s => s.label.length));
  const gradeLabelFontSize = maxLabelLen >= 3 ? theme.fontSize.xs : theme.fontSize.sm;

  let cumDeg = 0;

  return (
    <View style={pieStyles.container}>
      {/* ヘッダー: 学習済み / トータル */}
      <Text style={[pieStyles.learnedHeader, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
        {t('stats.learnedOf', { learned, total })}
      </Text>
      {/* ドーナツチャート */}
      <Svg width={DONUT_SIZE} height={DONUT_SIZE}>
        <Circle cx={DONUT_CX} cy={DONUT_CY} r={DONUT_R} fill={theme.colors.progressBg} />
        {chartSlices.filter((s) => s.value > 0).map((slice) => {
          const sweepDeg = (slice.value / total) * 360;
          const path = donutArcPath(cumDeg, cumDeg + sweepDeg);
          cumDeg += sweepDeg;
          return <Path key={slice.label} d={path} fill={slice.color} />;
        })}
        <Circle cx={DONUT_CX} cy={DONUT_CY} r={DONUT_INNER_R} fill={theme.colors.surface} />
        <SvgText x={DONUT_CX} y={DONUT_CY + 10} textAnchor="middle" fontSize={24} fontWeight="700" fill={theme.colors.text}>
          {pct}
        </SvgText>
      </Svg>
      {/* グレード別横並びグリッド */}
      <View style={[pieStyles.gradeGrid, {
        maxWidth: Math.min(screenWidth * 0.92, 520),
        gap: Math.max(8, Math.round(theme.fontSize.xs * 0.9)),
      }]}>
        {slices.map((slice) => {
          const pct = Math.round((slice.value / total) * 100);
          return (
            <View key={slice.label} style={pieStyles.gradeGridItem}>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[pieStyles.gradeGridCount, { color: slice.color, fontSize: gradeCountFontSize }]} allowFontScaling={false}>
                {slice.value}
              </Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[pieStyles.gradeGridLabel, { color: theme.colors.textSecondary, fontSize: gradeLabelFontSize }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                {slice.label}
              </Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[pieStyles.gradeGridPct, { color: theme.colors.textSecondary, fontSize: gradeLabelFontSize }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {pct}%
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const pieStyles = StyleSheet.create({
  container: { alignItems: 'center', gap: 16, paddingVertical: 8 },
  learnedHeader: { marginBottom: 4 },
  gradeGrid: { flexDirection: 'row', justifyContent: 'center', paddingTop: 4, paddingBottom: 4, alignSelf: 'center', width: '100%' },
  gradeGridItem: { flex: 1, alignItems: 'center', gap: 2 },
  gradeGridCount: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  gradeGridLabel: { fontWeight: '600' },
  gradeGridPct: {},
});

function BarChart({
  schedule,
  locale,
  theme,
  barColor,
  todayIsLast = false,
}: {
  schedule: ScheduleItem[];
  locale: string;
  theme: AppTheme;
  barColor?: string;
  todayIsLast?: boolean;
}) {
  const labels = locale.startsWith('ja') ? DAY_LABELS_JA : DAY_LABELS_EN;
  const maxCount = Math.max(...schedule.map((s) => s.count), 1);
  const color = barColor ?? theme.colors.primary;

  const barCountH = Math.ceil(theme.fontSize.xs * 1.95);
  const barLabelH = Math.ceil(theme.fontSize.sm * 1.95);
  const chartH = BAR_MAX_HEIGHT + barCountH + barLabelH + 8;

  return (
    <View style={[styles.barChart, { height: chartH }]}>
      {schedule.map((item, i) => {
        const barH = Math.max((item.count / maxCount) * BAR_MAX_HEIGHT, item.count > 0 ? 4 : 0);
        const dayIndex = new Date(item.date + 'T00:00:00').getDay();
        const isToday = todayIsLast ? i === schedule.length - 1 : i === 0;

        return (
          <View key={item.date} style={styles.barCol}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit={!(Platform as any).isPad}
              style={[styles.barCount, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs, height: barCountH }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {item.count > 0 ? item.count : ''}
            </Text>
            <View style={[styles.bar, { height: barH, backgroundColor: color, opacity: isToday ? 1 : 0.35 }]} />
            <Text style={[styles.barLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm, height: barLabelH }, isToday && { color }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {labels[dayIndex]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const MONTH_BAR_COL_W = 44;
const MONTH_LABELS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function MonthBarChart({ data, theme }: { data: { month: string; count: number }[]; theme: AppTheme }) {
  const { i18n } = useTranslation();
  const isJa = i18n.language.startsWith('ja');
  const scrollRef = useRef<ScrollView>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const barCountH = Math.ceil(theme.fontSize.xs * 1.95);
  const barLabelH = Math.ceil(theme.fontSize.sm * 1.95);
  const chartH = BAR_MAX_HEIGHT + barCountH + barLabelH + 8;

  // コンテナ幅が列の最小合計より広い（iPad 等）ときは列幅を均等に拡げ、横スクロールを無効化
  const totalMinWidth = data.length * MONTH_BAR_COL_W;
  const fitsInContainer = containerWidth > 0 && containerWidth >= totalMinWidth;
  const colW = fitsInContainer ? containerWidth / data.length : MONTH_BAR_COL_W;
  const innerWidth = fitsInContainer ? containerWidth : totalMinWidth;

  return (
    <View onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scrollRef}
        horizontal
        scrollEnabled={!fitsInContainer}
        showsHorizontalScrollIndicator={false}
        onLayout={() => { if (!fitsInContainer) scrollRef.current?.scrollToEnd({ animated: false }); }}
      >
        <View style={[styles.barChart, { height: chartH, width: innerWidth }]}>
          {data.map((item, i) => {
            const barH = Math.max((item.count / maxCount) * BAR_MAX_HEIGHT, item.count > 0 ? 4 : 0);
            const monthNum = parseInt(item.month.split('-')[1]);
            const label = isJa ? `${monthNum}月` : MONTH_LABELS_EN[monthNum - 1];
            const isCurrentMonth = i === data.length - 1;
            return (
              <View key={item.month} style={[styles.barCol, { width: colW }]}>
                <Text style={[styles.barCount, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs, height: barCountH }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {item.count > 0 ? item.count : ''}
                </Text>
                <View style={[styles.bar, { height: barH, backgroundColor: theme.colors.primary, opacity: isCurrentMonth ? 1 : 0.35 }]} />
                <Text style={[styles.barLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm, height: barLabelH }, isCurrentMonth && { color: theme.colors.primary }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function DeckMasteryRow({ deck, mastery, theme, onPress }: { deck: Deck; mastery: MasteryItem; theme: AppTheme; onPress: () => void }) {
  const { t } = useTranslation();
  const pct = masteryPercent(mastery.avgEase);
  const color = masteryColor(pct);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.masteryRow, pressed && { opacity: 0.7 }]}>
      <View style={styles.masteryHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
          {deck.iconName && (
            <Ionicons
              name={deck.iconName as any}
              size={Math.round(16 * theme.fontScale)}
              color={deck.colorHex ?? theme.colors.primary}
            />
          )}
          <Text style={[styles.masteryDeckName, { color: theme.colors.text, fontSize: theme.fontSize.md }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {deck.name}
          </Text>
        </View>
        <Text style={[styles.masteryPct, { color, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{pct}%</Text>
      </View>
      <View style={[styles.masteryBarBg, { backgroundColor: theme.colors.progressBg }]}>
        <View style={[styles.masteryBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.masterySubLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
        {t('common.learned')}: {mastery.learnedCount}{'        '}{t('common.new')}: {mastery.newCount}
      </Text>
    </Pressable>
  );
}

function DonutSheet({
  visible,
  title,
  dist,
  onClose,
  theme,
}: {
  visible: boolean;
  title: string;
  dist: GradeDistribution | null;
  onClose: () => void;
  theme: AppTheme;
}) {
  const { t } = useTranslation();
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

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, overlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[sheetStyle, sheetStyles.sheet, { backgroundColor: theme.colors.surface }]}>
        <View style={[sheetStyles.header, { justifyContent: 'center' }]}>
          <Text style={[sheetStyles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg, textAlign: 'center' }]} numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {title}
          </Text>
        </View>
        <Pressable onPress={onClose} style={[sheetStyles.closeBtn, { position: 'absolute', top: 14, right: 16, zIndex: 1 }]}>
          <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
        </Pressable>
        <View style={sheetStyles.body}>
          {dist ? (
            <GradeDistPieChart dist={dist} theme={theme} />
          ) : (
            <Text style={{ color: theme.colors.textTertiary, textAlign: 'center', paddingVertical: 16 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('common.loading')}
            </Text>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const sheetStyles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32, maxHeight: '70%' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  title: { fontWeight: '700' },
  closeBtn: { padding: 4 },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
});

function DeckPickerSheet({
  visible,
  value,
  decks,
  onSelect,
  onClose,
  theme,
}: {
  visible: boolean;
  value: string | null;
  decks: Deck[];
  onSelect: (v: string | null) => void;
  onClose: () => void;
  theme: AppTheme;
}) {
  const { t } = useTranslation();
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

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, overlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[sheetStyle, sheetStyles.sheet, { backgroundColor: theme.colors.surface }]}>
        <View style={[sheetStyles.header, { justifyContent: 'center' }]}>
          <Text style={[sheetStyles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg, textAlign: 'center' }]} numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('stats.gradeRankingDeckTitle')}
          </Text>
        </View>
        <Pressable onPress={onClose} style={[sheetStyles.closeBtn, { position: 'absolute', top: 14, right: 16, zIndex: 1 }]}>
          <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
        </Pressable>
        <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={sheetStyles.body}>
          {/* すべてのデッキ */}
          <Pressable
            onPress={() => { onSelect(null); onClose(); }}
            style={({ pressed }) => [
              {
                paddingVertical: 14,
                paddingHorizontal: 12,
                borderRadius: 8,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: value === null ? theme.colors.primary : 'transparent',
              },
              pressed && value !== null && { backgroundColor: theme.colors.buttonBorder },
            ]}
          >
            <Text style={{ color: value === null ? theme.colors.primaryText : theme.colors.text, fontSize: theme.fontSize.md, fontWeight: value === null ? '600' : '400' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('stats.gradeRankingDeckAll')}
            </Text>
            {value === null && <Ionicons name="checkmark" size={20} color={theme.colors.primaryText} />}
          </Pressable>
          {decks.map((deck) => {
            const isSelected = value === deck.id;
            return (
              <Pressable
                key={deck.id}
                onPress={() => { onSelect(deck.id); onClose(); }}
                style={({ pressed }) => [
                  {
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: isSelected ? theme.colors.primary : 'transparent',
                  },
                  pressed && !isSelected && { backgroundColor: theme.colors.buttonBorder },
                ]}
              >
                <Text style={{ color: isSelected ? theme.colors.primaryText : theme.colors.text, fontSize: theme.fontSize.md, fontWeight: isSelected ? '600' : '400', flex: 1 }} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {deck.name}
                </Text>
                {isSelected && <Ionicons name="checkmark" size={20} color={theme.colors.primaryText} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function PeriodPickerSheet({
  visible,
  value,
  onSelect,
  onClose,
  theme,
}: {
  visible: boolean;
  value: GradeRankingPeriod;
  onSelect: (v: GradeRankingPeriod) => void;
  onClose: () => void;
  theme: AppTheme;
}) {
  const { t } = useTranslation();
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

  const options: { key: GradeRankingPeriod; labelKey: string }[] = [
    { key: 'all', labelKey: 'stats.gradeRankingPeriodAll' },
    { key: '90d', labelKey: 'stats.gradeRankingPeriod90d' },
    { key: '30d', labelKey: 'stats.gradeRankingPeriod30d' },
    { key: '7d',  labelKey: 'stats.gradeRankingPeriod7d' },
  ];

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, overlayStyle, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[sheetStyle, sheetStyles.sheet, { backgroundColor: theme.colors.surface }]}>
        <View style={[sheetStyles.header, { justifyContent: 'center' }]}>
          <Text style={[sheetStyles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg, textAlign: 'center' }]} numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('stats.gradeRankingPeriodTitle')}
          </Text>
        </View>
        <Pressable onPress={onClose} style={[sheetStyles.closeBtn, { position: 'absolute', top: 14, right: 16, zIndex: 1 }]}>
          <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
        </Pressable>
        <View style={sheetStyles.body}>
          {options.map((opt) => {
            const isSelected = value === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => { onSelect(opt.key); onClose(); }}
                style={({ pressed }) => [
                  {
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: isSelected ? theme.colors.primary : 'transparent',
                  },
                  pressed && !isSelected && { backgroundColor: theme.colors.buttonBorder },
                ]}
              >
                <Text style={{ color: isSelected ? theme.colors.primaryText : theme.colors.text, fontSize: theme.fontSize.md, fontWeight: isSelected ? '600' : '400' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {t(opt.labelKey)}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark" size={20} color={theme.colors.primaryText} />
                )}
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
}

/** GradeRankingPeriod から since の ISO 文字列を計算（'all' のときは undefined） */
function periodToSince(period: GradeRankingPeriod): string | undefined {
  const days = GRADE_RANKING_PERIOD_DAYS[period];
  if (days == null) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** Date をローカル YYYY-MM-DD 文字列に変換 */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 過去12ヶ月分を昇順で埋める（欠落月は count: 0） */
function fillPast12Months(rows: { month: string; count: number }[]): { month: string; count: number }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (11 - i));
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const found = rows.find((r) => r.month === monthStr);
    return { month: monthStr, count: found?.count ?? 0 };
  });
}

/** 過去7日分を昇順で埋める（欠落日は count: 0、今日が最後） */
function fillPast7Days(rows: ScheduleItem[]): ScheduleItem[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = toLocalDateStr(d);
    const found = rows.find((r) => r.date === dateStr);
    return { date: dateStr, count: found?.count ?? 0 };
  });
}

// フォーカス対象（ヌルサイクル）
type FocusedItem =
  | null
  | { kind: 'total' }
  | { kind: 'deck'; idx: number }
  | { kind: 'card'; idx: number };

function isSameItem(a: FocusedItem, b: FocusedItem): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'total') return true;
  return a.idx === (b as { idx: number }).idx;
}

export default function StatsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { initialFilterPreference, keyboardShortcutsEnabled, gradeRankingByTime, setGradeRankingByTime, gradeRankingPeriod, setGradeRankingPeriod, gradeRankingDeckId, setGradeRankingDeckId } = useSettingsStore();
  const { isPro } = useProStore();
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<{
    total: number;
    decks: number[];
    proSection: number;
    ranking: number;
    rankingOuter: number;
    rankingInner: number;
  }>({ total: 0, decks: [], proSection: 0, ranking: 0, rankingOuter: 0, rankingInner: 0 });
  const pendingFocusRankingRef = useRef(false);
  const shouldScrollAfterLoadRef = useRef(false);
  const cardLayoutMap = useRef<Map<string, { y: number; h: number }>>(new Map());
  const scrollViewHeightRef = useRef(0);
  const currentScrollYRef = useRef(0);

  const [selectedBlock, setSelectedBlock] = useState<BlockKey>('due');
  const [stats, setStats] = useState<StatsData>(INITIAL_STATS);
  const [focusedItem, setFocusedItem] = useState<FocusedItem>(null);
  const [activeSheet, setActiveSheet] = useState<null | 'total' | number>(null);
  const [sheetDist, setSheetDist] = useState<GradeDistribution | null>(null);
  const [sheetTitle, setSheetTitle] = useState('');
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [selectedGradeBlock, setSelectedGradeBlock] = useState<0 | 1 | 2 | 3 | null>(null);
  const [gradeBlockCards, setGradeBlockCards] = useState<GradeCard[]>([]);
  const [gradeBlockLoading, setGradeBlockLoading] = useState(false);
  const [statsCardId, setStatsCardId] = useState<string | null>(null);
  const [periodPickerVisible, setPeriodPickerVisible] = useState(false);
  const [deckPickerVisible, setDeckPickerVisible] = useState(false);
  const selectedGradeBlockRef = useRef<0 | 1 | 2 | 3 | null>(null);

  useShortcutsHeader(keyboardShortcutsEnabled, () => setShowShortcutsModal(true));
  const { todayReviewed, todayDue, streak, learned, unlearned, todayCreated,
          schedule, past7DaysReviewed, past7DaysActivity, past7DaysCreated,
          deckMastery, decks, heatmapData, gradeTotals, gradeAvgTimes, monthlyReviewed } = stats;

  // openSheet 内で参照するため useMemo で安定化
  const deckMap = useMemo(
    () => Object.fromEntries(decks.map((d) => [d.id, d])),
    [decks]
  );

  const loadStats = useCallback(async () => {
    const heatmapStart = new Date();
    heatmapStart.setDate(heatmapStart.getDate() - HEATMAP_WEEKS * 7);
    const heatmapStartStr = toLocalDateStr(heatmapStart);
    const since = periodToSince(useSettingsStore.getState().gradeRankingPeriod);
    const deckIdFilter = useSettingsStore.getState().gradeRankingDeckId ?? undefined;

    const [reviewed, due, s, rawSchedule, counts, mastery, allDecks, rawReviewed, rawActivity, rawCreated, createdToday, rawHeatmap, rawMonthly, gradeTotalsData, gradeAvgTimesData] =
      await Promise.all([
        getTodayReviewedCount(db),
        getTodayDueCount(db),
        getStudyStreak(db),
        getUpcomingSchedule(db),
        getLearnedUnlearnedCount(db),
        getDeckMasteryList(db),
        getAllDecks(db),
        getPast7DaysReviewedCount(db),
        getPast7DaysStudyActivity(db),
        getPast7DaysCreatedCount(db),
        getTodayCreatedCount(db),
        getDailyReviewCounts(db, heatmapStartStr),
        getMonthlyReviewCounts(db),
        getGradeLogTotals(db, since, deckIdFilter),
        getGradeAvgResponseTimes(db, since, deckIdFilter),
      ]);

    // 今後7日分（今日が先頭）
    const filledSchedule: ScheduleItem[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = toLocalDateStr(d);
      const found = rawSchedule.find((r) => r.date === dateStr);
      return { date: dateStr, count: i === 0 ? due : (found?.count ?? 0) };
    });

    setStats({
      todayReviewed: reviewed,
      todayDue: due,
      streak: s,
      learned: counts.learned,
      unlearned: counts.unlearned,
      todayCreated: createdToday,
      schedule: filledSchedule,
      past7DaysReviewed: fillPast7Days(rawReviewed),
      past7DaysActivity: fillPast7Days(rawActivity),
      past7DaysCreated: fillPast7Days(rawCreated),
      deckMastery: mastery,
      decks: allDecks,
      heatmapData: rawHeatmap,
      gradeTotals: gradeTotalsData,
      gradeAvgTimes: gradeAvgTimesData,
      monthlyReviewed: fillPast12Months(rawMonthly),
    });
    if (selectedGradeBlockRef.current !== null) {
      const sortBy = useSettingsStore.getState().gradeRankingByTime ? 'time' : 'count';
      const cards = await getTopCardsByGrade(db, selectedGradeBlockRef.current, 10, sortBy, since, deckIdFilter);
      setGradeBlockCards(cards);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      onScreenFocus();
      const blockMap: Record<InitialFilterPreference, BlockKey | null> = {
        all: 'streak', learned: 'learned', review: 'due', new: 'new', none: null,
      };
      const initial = blockMap[initialFilterPreference];
      if (initial !== null) setSelectedBlock(initial);
      loadStats();
      return () => { onScreenBlur(); };
    }, [initialFilterPreference, onScreenFocus, onScreenBlur, loadStats])
  );

  // 同期（ダウンロード）でローカルデータが入れ替わったら、フォーカス中でも統計を再読込する。
  const dataRevision = useSyncStore((s) => s.dataRevision);
  useEffect(() => {
    if (dataRevision === 0) return;
    loadStats();
  }, [dataRevision, loadStats]);

  const focusList = useMemo<FocusedItem[]>(() => {
    const list: FocusedItem[] = [
      { kind: 'total' },
      ...deckMastery.map((_, i) => ({ kind: 'deck' as const, idx: i })),
    ];
    if (isPro && selectedGradeBlock !== null && gradeBlockCards.length > 0) {
      gradeBlockCards.forEach((_, i) => list.push({ kind: 'card', idx: i }));
    }
    return list;
  }, [deckMastery, isPro, selectedGradeBlock, gradeBlockCards]);

  function scrollToRankingTop() {
    const y = sectionOffsets.current.proSection + sectionOffsets.current.ranking;
    scrollViewRef.current?.scrollTo({ y: Math.max(y, 0), animated: true });
  }

  function scrollToCardIfNeeded(cardId: string) {
    const layout = cardLayoutMap.current.get(cardId);
    const scroll = scrollViewRef.current;
    if (!layout || !scroll) return;
    const absY =
      sectionOffsets.current.proSection +
      sectionOffsets.current.ranking +
      sectionOffsets.current.rankingOuter +
      sectionOffsets.current.rankingInner +
      layout.y;
    const viewportH = scrollViewHeightRef.current;
    const curY = currentScrollYRef.current;
    if (viewportH <= 0) {
      // ScrollView height 未計測 → 大まかにカード上端を viewport 上から少し下に
      scroll.scrollTo({ y: Math.max(absY - 100, 0), animated: true });
      return;
    }
    // 既に画面内にあれば何もしない
    if (absY >= curY && absY + layout.h <= curY + viewportH) return;
    if (absY < curY) {
      scroll.scrollTo({ y: Math.max(absY - 16, 0), animated: true });
    } else {
      scroll.scrollTo({ y: absY + layout.h - viewportH + 16, animated: true });
    }
  }

  function scrollToFocus(item: FocusedItem) {
    if (item === null) return;
    if (item.kind === 'total') {
      scrollViewRef.current?.scrollTo({ y: sectionOffsets.current.total, animated: true });
    } else if (item.kind === 'deck') {
      const y = sectionOffsets.current.decks[item.idx] ?? 0;
      scrollViewRef.current?.scrollTo({ y: sectionOffsets.current.total + y, animated: true });
    } else if (item.kind === 'card') {
      const card = gradeBlockCards[item.idx];
      if (card) scrollToCardIfNeeded(card.cardId);
    }
  }

  function moveFocus(dir: 'next' | 'prev') {
    // グレード切替直後の bias：先頭/末尾のランキングカードへ
    if (pendingFocusRankingRef.current) {
      pendingFocusRankingRef.current = false;
      if (gradeBlockCards.length > 0) {
        const next: FocusedItem = { kind: 'card', idx: dir === 'next' ? 0 : gradeBlockCards.length - 1 };
        setFocusedItem(next);
        scrollToFocus(next);
        return;
      }
    }
    setFocusedItem((prev) => {
      let next: FocusedItem;
      if (dir === 'next') {
        if (prev === null) {
          next = focusList[0] ?? null;
        } else {
          const i = focusList.findIndex((it) => isSameItem(it, prev));
          next = i < 0 || i + 1 >= focusList.length ? null : focusList[i + 1];
        }
      } else {
        if (prev === null) {
          next = focusList[focusList.length - 1] ?? null;
        } else {
          const i = focusList.findIndex((it) => isSameItem(it, prev));
          next = i <= 0 ? null : focusList[i - 1];
        }
      }
      scrollToFocus(next);
      return next;
    });
  }

  // フォーカスが現在の focusList から外れた場合（例：グレード切替でカードリストが空になった等）にクリア
  useEffect(() => {
    if (focusedItem === null) return;
    const exists = focusList.some((it) => isSameItem(it, focusedItem));
    if (!exists) setFocusedItem(null);
  }, [focusList, focusedItem]);

  function handleGradeKey(grade: 0 | 1 | 2 | 3) {
    if (!isPro) return;
    // 同じグレードを連打しても解除しない（1–4 キーと同じ idempotent な作り）。
    // タップ側のトグル動作は handleGradeBlockTap 側でそのまま維持。
    if (selectedGradeBlock !== grade) {
      handleGradeBlockTap(grade);
    }
    setFocusedItem(null);
    pendingFocusRankingRef.current = true;
    shouldScrollAfterLoadRef.current = true;
    // キャッシュ済みケース用に即時スクロール（measureLayout で最新位置を取得）
    scrollToRankingTop();
  }

  // カード読み込み完了後、ランキング位置に再スクロール（async ロードで高さが変わるため）
  useEffect(() => {
    if (shouldScrollAfterLoadRef.current && !gradeBlockLoading && selectedGradeBlock !== null) {
      shouldScrollAfterLoadRef.current = false;
      // レイアウト確定を待つため次フレームで実行
      requestAnimationFrame(() => scrollToRankingTop());
    }
  }, [gradeBlockLoading, gradeBlockCards, selectedGradeBlock]);

  // CardStatsSheet 閉じた直後に hidden TextInput を再フォーカス（deck/[id]/index.tsx と同じパターン）
  useEffect(() => {
    if (statsCardId === null && keyboardShortcutsEnabled) {
      const timer = setTimeout(() => keyboardRef.current?.focus(), 300);
      return () => clearTimeout(timer);
    }
  }, [statsCardId, keyboardShortcutsEnabled, keyboardRef]);

  const openSheet = useCallback(async (target: 'total' | number) => {
    setActiveSheet(target);
    setSheetDist(null);
    if (target === 'total') {
      setSheetTitle(t('stats.totalProgress'));
      const dist = await getAllGradeDistribution(db);
      setSheetDist(dist);
    } else {
      const m = deckMastery[target];
      if (!m) return;
      setSheetTitle(deckMap[m.deckId]?.name ?? '');
      const dist = await getDeckGradeDistribution(db, m.deckId);
      setSheetDist(dist);
    }
  }, [db, deckMastery, deckMap, t]);

  const closeSheet = useCallback(() => setActiveSheet(null), []);

  const handleGradeBlockTap = useCallback(async (grade: 0 | 1 | 2 | 3) => {
    if (selectedGradeBlock === grade) {
      selectedGradeBlockRef.current = null;
      setSelectedGradeBlock(null);
      setGradeBlockCards([]);
      return;
    }
    selectedGradeBlockRef.current = grade;
    setSelectedGradeBlock(grade);
    setFocusedItem(null);
    pendingFocusRankingRef.current = true;
    setGradeBlockLoading(true);
    // カードをクリアしない → コンテンツ高さを維持してスクロール位置を保持
    const sortBy = useSettingsStore.getState().gradeRankingByTime ? 'time' : 'count';
    const since = periodToSince(useSettingsStore.getState().gradeRankingPeriod);
    const deckIdFilter = useSettingsStore.getState().gradeRankingDeckId ?? undefined;
    const cards = await getTopCardsByGrade(db, grade, 10, sortBy, since, deckIdFilter);
    setGradeBlockCards(cards);
    setGradeBlockLoading(false);
  }, [db, selectedGradeBlock]);

  // 平均時間ランキングトグル切り替え時：選択中のグレードブロックの TOP10 を再取得
  const handleToggleRankingByTime = useCallback(async () => {
    const newValue = !gradeRankingByTime;
    setGradeRankingByTime(newValue);
    if (selectedGradeBlockRef.current !== null) {
      setGradeBlockLoading(true);
      const sortBy = newValue ? 'time' : 'count';
      const since = periodToSince(useSettingsStore.getState().gradeRankingPeriod);
      const deckIdFilter = useSettingsStore.getState().gradeRankingDeckId ?? undefined;
      const cards = await getTopCardsByGrade(db, selectedGradeBlockRef.current, 10, sortBy, since, deckIdFilter);
      setGradeBlockCards(cards);
      setGradeBlockLoading(false);
    }
  }, [db, gradeRankingByTime, setGradeRankingByTime]);

  // 重点復習を開始（選択中グレードの TOP カードでセッション開始）。ボタンと Space キーで共用。
  const startFocusedReview = useCallback(() => {
    if (gradeBlockCards.length === 0) return;
    const ids = gradeBlockCards.map((c) => c.cardId).join(',');
    router.push({ pathname: '/study/session', params: { cardIds: ids, mode: 'focused' } });
  }, [gradeBlockCards, router]);

  // 期間フィルター変更時：4ブロック集計と TOP10 を即時再取得
  const handlePeriodChange = useCallback(async (newPeriod: GradeRankingPeriod) => {
    setGradeRankingPeriod(newPeriod);
    const since = periodToSince(newPeriod);
    const sortBy = useSettingsStore.getState().gradeRankingByTime ? 'time' : 'count';
    const deckIdFilter = useSettingsStore.getState().gradeRankingDeckId ?? undefined;
    setGradeBlockLoading(true);
    const [totals, avgTimes, cards] = await Promise.all([
      getGradeLogTotals(db, since, deckIdFilter),
      getGradeAvgResponseTimes(db, since, deckIdFilter),
      selectedGradeBlockRef.current !== null
        ? getTopCardsByGrade(db, selectedGradeBlockRef.current, 10, sortBy, since, deckIdFilter)
        : Promise.resolve(null),
    ]);
    setStats((prev) => ({ ...prev, gradeTotals: totals, gradeAvgTimes: avgTimes }));
    if (cards !== null) setGradeBlockCards(cards);
    setGradeBlockLoading(false);
  }, [db, setGradeRankingPeriod]);

  // デッキ絞り込み変更時：4ブロック集計と TOP10 を即時再取得
  const handleDeckChange = useCallback(async (newDeckId: string | null) => {
    setGradeRankingDeckId(newDeckId);
    const since = periodToSince(useSettingsStore.getState().gradeRankingPeriod);
    const sortBy = useSettingsStore.getState().gradeRankingByTime ? 'time' : 'count';
    const deckIdFilter = newDeckId ?? undefined;
    setGradeBlockLoading(true);
    const [totals, avgTimes, cards] = await Promise.all([
      getGradeLogTotals(db, since, deckIdFilter),
      getGradeAvgResponseTimes(db, since, deckIdFilter),
      selectedGradeBlockRef.current !== null
        ? getTopCardsByGrade(db, selectedGradeBlockRef.current, 10, sortBy, since, deckIdFilter)
        : Promise.resolve(null),
    ]);
    setStats((prev) => ({ ...prev, gradeTotals: totals, gradeAvgTimes: avgTimes }));
    if (cards !== null) setGradeBlockCards(cards);
    setGradeBlockLoading(false);
  }, [db, setGradeRankingDeckId]);

  const hasData = learned > 0 || todayReviewed > 0;
  const total = learned + unlearned;
  const learnedPct = total > 0 ? Math.round((learned / total) * 100) : 0;

  if (!hasData && total === 0) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: theme.colors.background }]}>
        <EmptyState icon="bar-chart-outline" title={t('stats.empty')} subtitle={t('stats.emptySub')} />
      </View>
    );
  }

  const blockColors: Record<BlockKey, string> = {
    streak: theme.colors.primary,
    learned: FILTER_COLORS.learned,
    due: FILTER_COLORS.due,
    new: theme.colors.textSecondary,
  };

  const chartConfig: { data: ScheduleItem[]; title: string; color: string; todayIsLast: boolean } =
    selectedBlock === 'learned'
      ? { data: past7DaysReviewed, title: t('stats.past7DaysReviewed'), color: FILTER_COLORS.learned, todayIsLast: true }
      : selectedBlock === 'streak'
        ? { data: past7DaysActivity, title: t('stats.past7DaysActivity'), color: theme.colors.primary, todayIsLast: true }
        : selectedBlock === 'new'
          ? { data: past7DaysCreated, title: t('stats.past7DaysCreated'), color: theme.colors.textSecondary, todayIsLast: true }
          : { data: schedule, title: t('stats.upcomingSchedule'), color: FILTER_COLORS.due, todayIsLast: false };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <HiddenKeyboardInput
        ref={keyboardRef}
        onKeyPress={({ nativeEvent: { key } }) => {
          if (!keyboardShortcutsEnabled) return;
          // CardStatsSheet 表示中は A のみ通す（Escape は iOS が横取りするため未対応）
          if (statsCardId !== null) {
            if (key.toLowerCase() === 'a') setStatsCardId(null);
            return;
          }
          if (key === ' ') {
            if (activeSheet !== null) {
              closeSheet();
            } else if (focusedItem?.kind === 'total') {
              openSheet('total');
            } else if (focusedItem?.kind === 'deck') {
              openSheet(focusedItem.idx);
            } else if (isPro && selectedGradeBlock !== null && gradeBlockCards.length > 0) {
              // グレード選択中（ランキングカードにフォーカス中 or フォーカスなし）→ 重点復習を開始
              startFocusedReview();
            }
            return;
          }
          const k = key.toLowerCase();
          if (key === '.') { router.navigate('/(tabs)/settings'); return; }
          if (key === ',') { router.navigate('/(tabs)/study'); return; }
          if (activeSheet !== null) { return; }
          if (key === '1') { setSelectedBlock('streak'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }
          else if (key === '2') { setSelectedBlock('learned'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }
          else if (key === '3') { setSelectedBlock('due'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }
          else if (key === '4') { setSelectedBlock('new'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }
          else if (key === '6') { handleGradeKey(0); }
          else if (key === '7') { handleGradeKey(1); }
          else if (key === '8') { handleGradeKey(2); }
          else if (key === '9') { handleGradeKey(3); }
          else if (key === '0') {
            // 隠しコマンド：グレード選択を解除（ランキング非表示に戻す）
            if (isPro && selectedGradeBlock !== null) {
              handleGradeBlockTap(selectedGradeBlock);
              setFocusedItem(null);
              pendingFocusRankingRef.current = false;
            }
          }
          else if (k === 'j') { moveFocus('next'); }
          else if (k === 'k') { moveFocus('prev'); }
          else if (k === 'p') {
            if (focusedItem?.kind === 'card') {
              const card = gradeBlockCards[focusedItem.idx];
              if (card) router.push(`/deck/${card.deckId}/card/${card.cardId}/edit`);
            }
          } else if (k === 'a') {
            if (!isPro) return;
            if (focusedItem?.kind === 'card') {
              const card = gradeBlockCards[focusedItem.idx];
              if (card) setStatsCardId(card.cardId);
            }
          } else if (k === 'd') {
            if (isPro) setDeckPickerVisible(true);
          } else if (k === 't') {
            if (isPro) setPeriodPickerVisible(true);
          } else if (k === 'm') {
            if (isPro) handleToggleRankingByTime();
          }
        }}
        onSubmitEditing={() => {
          if (!keyboardShortcutsEnabled) return;
          if (statsCardId !== null) return;
          if (activeSheet !== null) { closeSheet(); return; }
          if (focusedItem?.kind === 'card') {
            const card = gradeBlockCards[focusedItem.idx];
            if (card) router.push(`/deck/${card.deckId}/card/${card.cardId}/edit`);
            return;
          }
          if (focusedItem?.kind === 'total') { openSheet('total'); return; }
          if (focusedItem?.kind === 'deck') { openSheet(focusedItem.idx); return; }
        }}
        onBlur={onInputBlur}
      />
      {(() => {
        const statNums = [streak, todayReviewed, todayDue, todayCreated];
        const maxDigits = Math.max(...statNums.map(n => String(n).length));
        const statValueFontSize = fontSizeForDigits(theme, (Platform as any).isPad ? 1 : maxDigits);
        const statBlockMinHeight = 32 + Math.ceil(fontSizeForDigits(theme, 1) * 1.35) + 2 + Math.ceil(theme.fontSize.xs * 1.35);
        return (
      <View style={[styles.summarySection, { backgroundColor: theme.colors.background }]}>
        <View style={styles.summaryRow}>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.primary, minHeight: statBlockMinHeight },
            selectedBlock === 'streak' && { margin: 0, borderWidth: 2, borderColor: blockColors.streak },
          ]}
          onPress={() => { setSelectedBlock('streak'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }}
        >
          <Text numberOfLines={1} allowFontScaling={false} style={[styles.summaryValue, { color: '#FFF', fontSize: statValueFontSize }]}>
            {streak}
          </Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: 'rgba(255,255,255,0.85)', textAlign: 'center', fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('stats.streak')}
          </Text>
          {(() => { const m = getStreakMedal(streak); return m ? <Ionicons name={m.name} size={(Platform as any).isPad ? theme.fontSize.xxxl : theme.fontSize.xl} color={m.color} style={[styles.streakMedalBadge, (Platform as any).isPad && styles.streakMedalBadgePad]} /> : null; })()}
        </Pressable>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface, minHeight: statBlockMinHeight },
            selectedBlock === 'learned' && { margin: 0, borderWidth: 2, borderColor: blockColors.learned },
          ]}
          onPress={() => { setSelectedBlock('learned'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }}
        >
          <Text numberOfLines={1} allowFontScaling={false} style={[styles.summaryValue, { color: FILTER_COLORS.learned, fontSize: statValueFontSize }]}>{todayReviewed}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center', fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('common.learned')}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface, minHeight: statBlockMinHeight },
            selectedBlock === 'due' && { margin: 0, borderWidth: 2, borderColor: blockColors.due },
          ]}
          onPress={() => { setSelectedBlock('due'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }}
        >
          <Text numberOfLines={1} allowFontScaling={false} style={[styles.summaryValue, { color: FILTER_COLORS.due, fontSize: statValueFontSize }]}>{todayDue}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center', fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('common.due')}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface, minHeight: statBlockMinHeight },
            selectedBlock === 'new' && { margin: 0, borderWidth: 2, borderColor: blockColors.new },
          ]}
          onPress={() => { setSelectedBlock('new'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }}
        >
          <Text numberOfLines={1} allowFontScaling={false} style={[styles.summaryValue, { color: theme.colors.textSecondary, fontSize: statValueFontSize }]}>{todayCreated}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center', fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('common.new')}</Text>
        </Pressable>
        </View>
      </View>
        );
      })()}
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
        scrollsToTop={false}
        onLayout={(e) => { scrollViewHeightRef.current = e.nativeEvent.layout.height; }}
        onScroll={(e) => { currentScrollYRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={32}
      >

      {/* 7日間バーチャート */}
      <Pressable style={styles.section} onPress={() => setFocusedItem(null)}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
          {chartConfig.title}
        </Text>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <BarChart
            schedule={chartConfig.data}
            locale={i18n.language}
            theme={theme}
            barColor={chartConfig.color}
            todayIsLast={chartConfig.todayIsLast}
          />
        </View>
      </Pressable>

      {/* 学習履歴（草グラフ） */}
      <Pressable style={styles.section} onPress={() => setFocusedItem(null)}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
          {t('stats.activityHeatmap')}
        </Text>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <ActivityHeatmap data={heatmapData} />
        </View>
      </Pressable>

      {/* 全体学習率 */}
      <View
        style={styles.section}
        onLayout={(e) => { sectionOffsets.current.total = e.nativeEvent.layout.y; }}
      >
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
          {t('stats.totalProgress')}
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: theme.colors.surface },
            focusedItem?.kind === 'total' && { borderWidth: 2, borderColor: theme.colors.primary },
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => { setFocusedItem({ kind: 'total' }); activeSheet === 'total' ? closeSheet() : openSheet('total'); }}
        >
          <View style={styles.masteryHeader}>
            <Text style={[styles.masteryDeckName, { color: theme.colors.text, fontSize: theme.fontSize.md }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('stats.allDecks')}</Text>
            <Text style={[styles.progressPct, { color: theme.colors.primary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{learnedPct}%</Text>
          </View>
          <View style={[styles.progressBarBg, { backgroundColor: theme.colors.progressBg }]}>
            <View style={[styles.progressBarFill, { width: `${learnedPct}%` }]} />
          </View>
          <Text style={[styles.progressSubLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
            {t('common.learned')}: {learned}{'        '}{t('common.new')}: {unlearned}
          </Text>
        </Pressable>
      </View>

      {/* デッキ別習熟度 */}
      {deckMastery.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('stats.deckMastery')}
          </Text>
          <View style={styles.deckMasteryList}>
            {deckMastery.map((m, idx) => {
              const deck = deckMap[m.deckId];
              if (!deck) return null;
              const isFocused = focusedItem?.kind === 'deck' && focusedItem.idx === idx;
              return (
                <View
                  key={m.deckId}
                  style={[
                    styles.card,
                    { backgroundColor: theme.colors.surface },
                    isFocused && { borderWidth: 2, borderColor: theme.colors.primary },
                  ]}
                  onLayout={(e) => { sectionOffsets.current.decks[idx] = e.nativeEvent.layout.y; }}
                >
                  <DeckMasteryRow deck={deck} mastery={m} theme={theme} onPress={() => { setFocusedItem({ kind: 'deck', idx }); activeSheet === idx ? closeSheet() : openSheet(idx); }} />
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* 詳細統計（Pro） */}
      <View
        style={styles.section}
        onLayout={(e) => { sectionOffsets.current.proSection = e.nativeEvent.layout.y; }}
      >
        <View style={styles.proSectionTitle}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('stats.proSection')}
          </Text>
          <View style={[styles.proBadge, { backgroundColor: theme.colors.primary }]}>
            <Text style={[styles.proBadgeText, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>Pro</Text>
          </View>
        </View>

        {isPro ? (
          <>
            {/* 月別学習グラフ */}
            <Text style={[styles.proSubTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('stats.monthlyActivity')}
            </Text>
            <View style={[styles.card, { backgroundColor: theme.colors.surface, marginBottom: 12 }]}>
              <MonthBarChart data={monthlyReviewed} theme={theme} />
            </View>

            {/* グレード別ランキング */}
            <View onLayout={(e) => { sectionOffsets.current.ranking = e.nativeEvent.layout.y; }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.proSubTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginBottom: 0 }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('stats.gradeRanking')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pressable
                  onPress={() => setDeckPickerVisible(true)}
                  accessibilityLabel={t('stats.gradeRankingDeckOpen')}
                  style={[
                    styles.rankingToggleBtn,
                    { borderColor: gradeRankingDeckId !== null ? theme.colors.primary : theme.colors.buttonBorder, paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
                    gradeRankingDeckId !== null && { backgroundColor: theme.colors.primary },
                  ]}
                >
                  <Ionicons
                    name="albums-outline"
                    size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)}
                    color={gradeRankingDeckId !== null ? theme.colors.primaryText : theme.colors.textSecondary}
                  />
                </Pressable>
                <Pressable
                  onPress={() => setPeriodPickerVisible(true)}
                  accessibilityLabel={t('stats.gradeRankingPeriodOpen')}
                  style={[
                    styles.rankingToggleBtn,
                    { borderColor: gradeRankingPeriod !== 'all' ? theme.colors.primary : theme.colors.buttonBorder, paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
                    gradeRankingPeriod !== 'all' && { backgroundColor: theme.colors.primary },
                  ]}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)}
                    color={gradeRankingPeriod !== 'all' ? theme.colors.primaryText : theme.colors.textSecondary}
                  />
                </Pressable>
                <Pressable
                  onPress={handleToggleRankingByTime}
                  accessibilityLabel={t(gradeRankingByTime ? 'stats.gradeRankingToggleCount' : 'stats.gradeRankingToggleTime')}
                  style={[
                    styles.rankingToggleBtn,
                    { borderColor: gradeRankingByTime ? theme.colors.primary : theme.colors.buttonBorder, paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
                    gradeRankingByTime && { backgroundColor: theme.colors.primary },
                  ]}
                >
                  <Ionicons
                    name="timer-outline"
                    size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)}
                    color={gradeRankingByTime ? theme.colors.primaryText : theme.colors.textSecondary}
                  />
                </Pressable>
              </View>
            </View>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs, marginBottom: (gradeRankingPeriod === 'all' && gradeRankingDeckId === null) ? 8 : 6 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
              {t(gradeRankingByTime ? 'stats.gradeRankingModeTime' : 'stats.gradeRankingModeCount')}
            </Text>
            {(gradeRankingPeriod !== 'all' || gradeRankingDeckId !== null) && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {gradeRankingDeckId !== null && (
                  <Pressable
                    onPress={() => handleDeckChange(null)}
                    style={[styles.filterChip, { backgroundColor: theme.colors.primary }]}
                  >
                    <Ionicons name="close" size={14} color={theme.colors.primaryText} />
                    <Text style={{ color: theme.colors.primaryText, fontSize: theme.fontSize.xs, fontWeight: '600' }} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                      {decks.find((d) => d.id === gradeRankingDeckId)?.name ?? t('stats.gradeRankingDeckAll')}
                    </Text>
                  </Pressable>
                )}
                {gradeRankingPeriod !== 'all' && (
                  <Pressable
                    onPress={() => handlePeriodChange('all')}
                    style={[styles.filterChip, { backgroundColor: theme.colors.primary }]}
                  >
                    <Ionicons name="close" size={14} color={theme.colors.primaryText} />
                    <Text style={{ color: theme.colors.primaryText, fontSize: theme.fontSize.xs, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                      {t(`stats.gradeRankingPeriod${gradeRankingPeriod}` as const)}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
            {(() => {
              const gradeItems = [
                { grade: 0 as const, labelKey: 'grade.again', color: GRADE_COLORS.again, count: gradeTotals.again, avgMs: gradeAvgTimes.again },
                { grade: 1 as const, labelKey: 'grade.hard',  color: GRADE_COLORS.hard,  count: gradeTotals.hard,  avgMs: gradeAvgTimes.hard  },
                { grade: 2 as const, labelKey: 'grade.good',  color: GRADE_COLORS.good,  count: gradeTotals.good,  avgMs: gradeAvgTimes.good  },
                { grade: 3 as const, labelKey: 'grade.easy',  color: GRADE_COLORS.easy,  count: gradeTotals.easy,  avgMs: gradeAvgTimes.easy  },
              ];
              const displayValues = gradeItems.map(g => gradeRankingByTime
                ? (g.avgMs != null ? (g.avgMs / 1000).toFixed(1) : '-')
                : String(g.count));
              const gradeMaxDigits = Math.max(...displayValues.map(v => v.length));
              const gradeCountFontSize = fontSizeForDigits(theme, (Platform as any).isPad ? 1 : gradeMaxDigits);
              // モード切替で高さがブレないよう、最大想定フォント（1桁時）でブロック高さを固定
              const gradeBlockMinHeight = 20 + Math.ceil(fontSizeForDigits(theme, 1) * 1.35) + 2 + Math.ceil(theme.fontSize.xs * 1.35);
              return (
            <View style={styles.gradeBlockRow}>
              {gradeItems.map(({ grade, labelKey, color }, i) => {
                const isSelected = selectedGradeBlock === grade;
                const value = displayValues[i];
                return (
                  <Pressable
                    key={grade}
                    style={[styles.gradeBlock, { borderColor: color, minHeight: gradeBlockMinHeight, justifyContent: 'center' }, isSelected ? { backgroundColor: color } : { backgroundColor: theme.colors.surface }]}
                    onPress={() => handleGradeBlockTap(grade)}
                  >
                    <Text style={[styles.gradeBlockCount, { color: isSelected ? '#fff' : color, fontSize: gradeCountFontSize }]} allowFontScaling={false} numberOfLines={1}>
                      {value}
                    </Text>
                    <Text style={[styles.gradeBlockLabel, { color: isSelected ? 'rgba(255,255,255,0.85)' : theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {t(labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
              );
            })()}

            {selectedGradeBlock !== null && (
              <View
                style={styles.gradeCardList}
                onLayout={(e) => { sectionOffsets.current.rankingOuter = e.nativeEvent.layout.y; }}
              >
                {gradeBlockCards.length > 0 && (
                  <View style={{ marginBottom: 4 }}>
                    <Pressable
                      onPress={startFocusedReview}
                      style={({ pressed }) => [styles.focusedReviewBtn, { backgroundColor: FILTER_COLORS.due }, pressed && { opacity: 0.85 }]}
                    >
                      <Ionicons name="play" size={20} color="#FFF" />
                      <Text style={[styles.focusedReviewBtnText, { fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                        {t('stats.focusedReviewStart')}
                      </Text>
                    </Pressable>
                    <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs, marginTop: 4 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                      {t('stats.focusedReviewNote')}
                    </Text>
                  </View>
                )}
                {gradeBlockLoading && gradeBlockCards.length === 0 ? (
                  // 初回：カードなしでローディング中
                  <View style={[styles.card, { backgroundColor: theme.colors.surface, padding: 20, alignItems: 'center' }]}>
                    <ActivityIndicator color={theme.colors.primary} />
                  </View>
                ) : gradeBlockCards.length === 0 ? (
                  <View style={[styles.card, { backgroundColor: theme.colors.surface, padding: 20, alignItems: 'center' }]}>
                    <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                      {t('stats.gradeRankingEmpty')}
                    </Text>
                  </View>
                ) : (
                  // 切り替え中は既存カードを薄表示、高さを維持してスクロール位置を保持
                  <View
                    style={[styles.gradeCardList, { opacity: gradeBlockLoading ? 0.4 : 1 }]}
                    onLayout={(e) => { sectionOffsets.current.rankingInner = e.nativeEvent.layout.y; }}
                  >
                  {gradeBlockCards.map((card, idx) => {
                    const preview = getCardPreview(JSON.parse(card.frontContent) as Block[], '');
                    const badgeColor = [GRADE_COLORS.again, GRADE_COLORS.hard, GRADE_COLORS.good, GRADE_COLORS.easy][selectedGradeBlock];
                    const isCardFocused = focusedItem?.kind === 'card' && focusedItem.idx === idx;
                    return (
                      <Pressable
                        key={card.cardId}
                        onLayout={(e) => {
                          cardLayoutMap.current.set(card.cardId, {
                            y: e.nativeEvent.layout.y,
                            h: e.nativeEvent.layout.height,
                          });
                        }}
                        style={({ pressed }) => [
                          styles.card,
                          styles.weakCardRow,
                          { backgroundColor: theme.colors.surface },
                          isCardFocused && { borderWidth: 2, borderColor: theme.colors.primary },
                          pressed && { opacity: 0.7 },
                        ]}
                        onPress={() => {
                          setFocusedItem({ kind: 'card', idx });
                          pendingFocusRankingRef.current = false;
                          router.push(`/deck/${card.deckId}/card/${card.cardId}/edit`);
                        }}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={[styles.weakCardPreview, { color: theme.colors.text, fontSize: theme.fontSize.sm }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                            {preview || '—'}
                          </Text>
                          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                            {card.deckName}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            setFocusedItem({ kind: 'card', idx });
                            pendingFocusRankingRef.current = false;
                            setStatsCardId(card.cardId);
                          }}
                          hitSlop={8}
                          style={{ padding: 4, marginRight: (Platform as any).isPad ? 16 : 4 }}
                        >
                          <Ionicons name="analytics-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
                        </Pressable>
                        <View style={[styles.lapseBadge, { backgroundColor: badgeColor }]}>
                          <Text style={styles.lapseBadgeText} allowFontScaling={false}>
                            {gradeRankingByTime
                              ? (card.avgResponseTimeMs != null ? `${(card.avgResponseTimeMs / 1000).toFixed(1)}${t('common.sec')}` : '-')
                              : t('stats.gradeCount', { count: card.gradeCount })}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  </View>
                )}
              </View>
            )}
            </View>
          </>
        ) : (
          <Pressable
            style={[styles.card, styles.proLockedCard, { backgroundColor: theme.colors.surface }]}
            onPress={() => router.push('/paywall')}
          >
            <Ionicons name="lock-closed-outline" size={28} color={theme.colors.textSecondary} />
            <Text style={[styles.proLockedTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {t('stats.proUpgradePrompt')}
            </Text>
            <View style={styles.proLockedFeatures}>
              {(['proFeatureMonthly', 'proFeatureGradeRanking'] as const).map((key) => (
                <View key={key} style={styles.proLockedFeatureRow}>
                  <Ionicons name="checkmark-circle-outline" size={14} color={theme.colors.primary} />
                  <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                    {t(`stats.${key}`)}
                  </Text>
                </View>
              ))}
            </View>
            <View style={[styles.proLockedBtn, { backgroundColor: theme.colors.primary }]}>
              <Text style={[styles.proLockedBtnText, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('pro.upgradeButton')}
              </Text>
            </View>
          </Pressable>
        )}
      </View>

      </ScrollView>
      <DonutSheet
        visible={activeSheet !== null}
        title={sheetTitle}
        dist={sheetDist}
        onClose={closeSheet}
        theme={theme}
      />
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        sections={STATS_SHORTCUT_SECTIONS.map((s) => ({ title: t(s.titleKey), items: s.items }))}
      />
      <CardStatsSheet cardId={statsCardId} onClose={() => setStatsCardId(null)} />
      <PeriodPickerSheet
        visible={periodPickerVisible}
        value={gradeRankingPeriod}
        onSelect={handlePeriodChange}
        onClose={() => setPeriodPickerVisible(false)}
        theme={theme}
      />
      <DeckPickerSheet
        visible={deckPickerVisible}
        value={gradeRankingDeckId}
        decks={decks}
        onSelect={handleDeckChange}
        onClose={() => setDeckPickerVisible(false)}
        theme={theme}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  summarySection: { paddingHorizontal: 16, paddingTop: 16 },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 4 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },

  // Summary row
  summaryRow: { flexDirection: 'row', gap: 4, marginHorizontal: -2, marginBottom: 8 },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 2,
    overflow: 'visible',
    ...SHADOW.card,
  },
  summaryValue: { fontWeight: '700' },
  summaryLabel: { marginTop: 2, textAlign: 'center', fontWeight: '600' },
  streakMedalBadge: { position: 'absolute', top: 2, right: 2 },
  streakMedalBadgePad: { top: 8, right: 8 },

  // Section
  section: { marginTop: 16 },
  sectionTitle: { fontWeight: '700', marginBottom: 8 },
  card: {
    borderRadius: 12,
    padding: 16,
    ...SHADOW.card,
  },

  // Bar chart
  barChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '60%', borderRadius: 4, minHeight: 0 },
  barCount: { textAlign: 'center' },
  barLabel: { textAlign: 'center' },

  // Progress
  progressPct: { fontWeight: '700' },
  progressBarBg: { height: 10, borderRadius: 5, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#1976D2', borderRadius: 5 },
  progressSubLabel: { marginTop: 6 },

  // Deck mastery
  deckMasteryList: { gap: 8 },
  masteryRow: { paddingVertical: 10 },
  masteryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  masteryDeckName: { fontWeight: '600', flex: 1, marginRight: 8 },
  masteryPct: { fontWeight: '700' },
  masteryBarBg: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 4 },
  masteryBarFill: { height: '100%', borderRadius: 4 },
  masterySubLabel: {},

  // Pro section
  proSectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  proBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  proBadgeText: { color: '#fff', fontWeight: '700', letterSpacing: 1 },
  proSubTitle: { fontWeight: '600', marginBottom: 6 },
  rankingToggleBtn: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  focusedReviewBtn: {
    flexDirection: 'row',
    borderRadius: 12,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  focusedReviewBtnText: { fontWeight: '700', color: '#FFF' },
  gradeBlockRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  gradeBlock: { flex: 1, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  gradeBlockCount: { fontWeight: '700' },
  gradeBlockLabel: { marginTop: 2, fontWeight: '600' },
  gradeCardList: { gap: 8 },
  weakCardRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  weakCardPreview: { fontWeight: '500' },
  lapseBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  lapseBadgeText: { color: '#fff', fontWeight: '600' },
  proLockedCard: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  proLockedTitle: { fontWeight: '700', textAlign: 'center' },
  proLockedFeatures: { gap: 4, alignSelf: 'center' },
  proLockedFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proLockedBtn: { borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10, marginTop: 4 },
  proLockedBtnText: { color: '#fff', fontWeight: '700' },
});
