import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';

import { DONUT_CX, DONUT_CY, DONUT_INNER_R, DONUT_R, DONUT_SIZE, donutArcPath } from '@/lib/donut';
import { useTheme, type AppTheme, FILTER_COLORS, GRADE_COLORS, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';
import type { InitialFilterPreference } from '@/store/settings';
import { getAllDecks } from '@/lib/database/decks';
import {
  getAllGradeDistribution,
  getDailyReviewCounts,
  getDeckGradeDistribution,
  getDeckMasteryList,
  getLearnedUnlearnedCount,
  getPast7DaysReviewedCount,
  getPast7DaysStudyActivity,
  getStudyStreak,
  getTodayDueCount,
  getTodayReviewedCount,
  getUpcomingSchedule,
} from '@/lib/database/reviews';
import ActivityHeatmap from '@/components/stats/ActivityHeatmap';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { EmptyState } from '@/components/EmptyState';
import { getPast7DaysCreatedCount, getTodayCreatedCount } from '@/lib/database/cards';
import type { Deck } from '@/types';

const STATS_SHORTCUTS = [
  { key: '1–4',   descKey: 'settings.shortcutSelectBlock' },
  { key: 'J / K',   descKey: 'settings.shortcutFocusNextPrev' },
  { key: 'Return / Space', descKey: 'settings.shortcutOpenDonut' },
  { key: ', / .', descKey: 'settings.shortcutTabNextPrev' },
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
};

// ──────────────────────────────────────────────
// SVG Donut Chart
// ──────────────────────────────────────────────
type PieSlice = { value: number; color: string; label: string };

function GradeDistPieChart({ dist, theme }: { dist: GradeDistribution; theme: AppTheme }) {
  const { t } = useTranslation();
  const total = dist.again + dist.hard + dist.normal + dist.easy + dist.unlearned;
  if (total === 0) return null;

  const learned = dist.again + dist.hard + dist.normal + dist.easy;
  const pct = total > 0 ? Math.round((learned / total) * 100) : 0;

  const slices: PieSlice[] = [
    { value: dist.again,     color: GRADE_COLORS.again, label: t('grade.again') },
    { value: dist.hard,      color: GRADE_COLORS.hard,  label: t('grade.hard') },
    { value: dist.normal,    color: GRADE_COLORS.good,  label: t('grade.good') },
    { value: dist.easy,      color: GRADE_COLORS.easy,  label: t('grade.easy') },
    { value: dist.unlearned, color: '#9E9E9E',           label: t('stats.unlearned') },
  ];

  const maxCountDigits = Math.max(...slices.map(s => String(s.value).length));
  const gradeCountFontSize = maxCountDigits >= 3 ? theme.fontSize.md : theme.fontSize.lg;
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
        {slices.filter((s) => s.value > 0).map((slice) => {
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
      <View style={pieStyles.gradeGrid}>
        {slices.map((slice) => {
          const pct = Math.round((slice.value / total) * 100);
          return (
            <View key={slice.label} style={pieStyles.gradeGridItem}>
              <Text numberOfLines={1} style={[pieStyles.gradeGridCount, { color: slice.color, fontSize: gradeCountFontSize }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {slice.value}
              </Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[pieStyles.gradeGridLabel, { color: theme.colors.textSecondary, fontSize: gradeLabelFontSize }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>
                {slice.label}
              </Text>
              <Text numberOfLines={1} style={[pieStyles.gradeGridPct, { color: theme.colors.textSecondary, fontSize: gradeLabelFontSize }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
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
  gradeGrid: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 4, paddingBottom: 4, maxWidth: 360, alignSelf: 'center', width: '100%' },
  gradeGridItem: { flex: 1, alignItems: 'center', gap: 2 },
  gradeGridCount: { fontWeight: '700' },
  gradeGridLabel: {},
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
            <Text style={[styles.barCount, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs, height: barCountH }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {item.count > 0 ? item.count : ''}
            </Text>
            <View style={[styles.bar, { height: barH, backgroundColor: color, opacity: isToday ? 1 : 0.35 }]} />
            <Text style={[styles.barLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm, height: barLabelH }, isToday && { color, fontWeight: '700' }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {labels[dayIndex]}
            </Text>
          </View>
        );
      })}
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
        <Text style={[styles.masteryDeckName, { color: theme.colors.text, fontSize: theme.fontSize.md }]} numberOfLines={1}>
          {deck.name}
        </Text>
        <Text style={[styles.masteryPct, { color, fontSize: theme.fontSize.md }]}>{pct}%</Text>
      </View>
      <View style={[styles.masteryBarBg, { backgroundColor: theme.colors.progressBg }]}>
        <View style={[styles.masteryBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.masterySubLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }]}>
        {t('stats.learned')}: {mastery.learnedCount}{'        '}{t('stats.unlearned')}: {mastery.newCount}
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
  const sheetY = useSharedValue(500);
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      overlayOpacity.value = withTiming(1, { duration: 200 });
      sheetY.value = withTiming(0, { duration: 250 });
    } else {
      overlayOpacity.value = withTiming(0, { duration: 200 });
      sheetY.value = withTiming(500, { duration: 250 });
    }
  }, [visible]);

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
        <View style={sheetStyles.header}>
          <Text style={[sheetStyles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {title}
          </Text>
          <Pressable onPress={onClose} style={sheetStyles.closeBtn}>
            <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
          </Pressable>
        </View>
        <View style={sheetStyles.body}>
          {dist ? (
            <GradeDistPieChart dist={dist} theme={theme} />
          ) : (
            <Text style={{ color: theme.colors.textTertiary, textAlign: 'center', paddingVertical: 16 }}>
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
  title: { fontWeight: '700', flex: 1, marginRight: 12 },
  closeBtn: { padding: 4 },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
});

/** Date をローカル YYYY-MM-DD 文字列に変換 */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

// T/Y フォーカス対象: null = なし, 'total' = 全体学習率, number = デッキ別習熟度インデックス
type FocusedItem = null | 'total' | number;

export default function StatsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { initialFilterPreference, keyboardShortcutsEnabled } = useSettingsStore();
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<{ total: number; decks: number[] }>({ total: 0, decks: [] });

  const [selectedBlock, setSelectedBlock] = useState<BlockKey>('due');
  const [stats, setStats] = useState<StatsData>(INITIAL_STATS);
  const [focusedItem, setFocusedItem] = useState<FocusedItem>(null);
  const [activeSheet, setActiveSheet] = useState<null | 'total' | number>(null);
  const [sheetDist, setSheetDist] = useState<GradeDistribution | null>(null);
  const [sheetTitle, setSheetTitle] = useState('');
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  useLayoutEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigation as any).setOptions({
      headerRight: keyboardShortcutsEnabled ? () => (
        <Pressable onPress={() => setShowShortcutsModal(true)} style={{ paddingHorizontal: 8 }}>
          <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
        </Pressable>
      ) : undefined,
      headerRightContainerStyle: keyboardShortcutsEnabled ? { paddingRight: 8 } : undefined,
    });
  }, [keyboardShortcutsEnabled, theme]);
  const { todayReviewed, todayDue, streak, learned, unlearned, todayCreated,
          schedule, past7DaysReviewed, past7DaysActivity, past7DaysCreated,
          deckMastery, decks, heatmapData } = stats;

  // openSheet 内で参照するため useMemo で安定化
  const deckMap = useMemo(
    () => Object.fromEntries(decks.map((d) => [d.id, d])),
    [decks]
  );

  useFocusEffect(
    useCallback(() => {
      onScreenFocus();
      const blockMap: Record<InitialFilterPreference, BlockKey | null> = {
        all: 'streak', learned: 'learned', review: 'due', new: 'new', none: null,
      };
      const initial = blockMap[initialFilterPreference];
      if (initial !== null) setSelectedBlock(initial);
      async function load() {
        const heatmapStart = new Date();
        heatmapStart.setDate(heatmapStart.getDate() - HEATMAP_WEEKS * 7);
        const heatmapStartStr = toLocalDateStr(heatmapStart);

        const [reviewed, due, s, rawSchedule, counts, mastery, allDecks, rawReviewed, rawActivity, rawCreated, createdToday, rawHeatmap] =
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
        });
      }
      load();
      return () => { onScreenBlur(); };
    }, [db, initialFilterPreference, onScreenFocus, onScreenBlur])
  );

  function moveFocus(dir: 'next' | 'prev') {
    setFocusedItem((prev) => {
      let next: FocusedItem;
      if (dir === 'next') {
        if (prev === null) next = 'total';
        else if (prev === 'total') next = deckMastery.length > 0 ? 0 : null;
        else if (typeof prev === 'number') next = prev < deckMastery.length - 1 ? prev + 1 : null;
        else next = null;
      } else {
        if (prev === null) next = deckMastery.length > 0 ? deckMastery.length - 1 : 'total';
        else if (typeof prev === 'number') next = prev > 0 ? prev - 1 : 'total';
        else next = null; // 'total' → null
      }
      // スクロール
      if (next === 'total') {
        scrollViewRef.current?.scrollTo({ y: sectionOffsets.current.total, animated: true });
      } else if (typeof next === 'number') {
        const y = sectionOffsets.current.decks[next] ?? 0;
        scrollViewRef.current?.scrollTo({ y: sectionOffsets.current.total + y, animated: true });
      }
      return next;
    });
  }

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
      <TextInput
        ref={keyboardRef}
        style={styles.hiddenKeyboardInput}
        caretHidden
        keyboardType="ascii-capable"
        showSoftInputOnFocus={false}
        disableKeyboardShortcuts={true}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        onKeyPress={({ nativeEvent: { key } }) => {
          if (!keyboardShortcutsEnabled) return;
          if (key === ' ') {
            if (activeSheet !== null) { closeSheet(); } else if (focusedItem !== null) { openSheet(focusedItem); }
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
          else if (k === 'j') { moveFocus('next'); }
          else if (k === 'k') { moveFocus('prev'); }
        }}
        onSubmitEditing={() => {
          if (!keyboardShortcutsEnabled) return;
          if (activeSheet !== null) { closeSheet(); return; }
          if (focusedItem !== null) { openSheet(focusedItem); }
        }}
        onBlur={onInputBlur}
      />
      {(() => {
        const statNums = [streak, todayReviewed, todayDue, todayCreated];
        const maxDigits = Math.max(...statNums.map(n => String(n).length));
        const statValueFontSize = maxDigits >= 4 ? theme.fontSize.md : maxDigits >= 3 ? theme.fontSize.lg : maxDigits >= 2 ? theme.fontSize.xl : theme.fontSize.xxl;
        return (
      <View style={[styles.summarySection, { backgroundColor: theme.colors.background }]}>
        <View style={styles.summaryRow}>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.primary },
            selectedBlock === 'streak' && { borderWidth: 2, borderColor: blockColors.streak },
          ]}
          onPress={() => { setSelectedBlock('streak'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }}
        >
          <Text numberOfLines={1} style={[styles.summaryValue, { color: '#FFF', fontSize: statValueFontSize }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {streak}
          </Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: 'rgba(255,255,255,0.85)', textAlign: 'center', fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('stats.streak')}
          </Text>
          {(() => { const m = getStreakMedal(streak); return m ? <Ionicons name={m.name} size={theme.fontSize.xl} color={m.color} style={styles.streakMedalBadge} /> : null; })()}
        </Pressable>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface },
            selectedBlock === 'learned' && { borderWidth: 2, borderColor: blockColors.learned },
          ]}
          onPress={() => { setSelectedBlock('learned'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }}
        >
          <Text numberOfLines={1} style={[styles.summaryValue, { color: FILTER_COLORS.learned, fontSize: statValueFontSize }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{todayReviewed}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center', fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('stats.learned')}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface },
            selectedBlock === 'due' && { borderWidth: 2, borderColor: blockColors.due },
          ]}
          onPress={() => { setSelectedBlock('due'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }}
        >
          <Text numberOfLines={1} style={[styles.summaryValue, { color: FILTER_COLORS.due, fontSize: statValueFontSize }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{todayDue}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center', fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('stats.statDue')}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface },
            selectedBlock === 'new' && { borderWidth: 2, borderColor: blockColors.new },
          ]}
          onPress={() => { setSelectedBlock('new'); scrollViewRef.current?.scrollTo({ y: 0, animated: true }); }}
        >
          <Text numberOfLines={1} style={[styles.summaryValue, { color: theme.colors.textSecondary, fontSize: statValueFontSize }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{todayCreated}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center', fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('stats.newToday')}</Text>
        </Pressable>
        </View>
      </View>
        );
      })()}
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.content}>

      {/* 7日間バーチャート */}
      <Pressable style={styles.section} onPress={() => setFocusedItem(null)}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}>
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
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}>
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
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}>
          {t('stats.totalProgress')}
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: theme.colors.surface },
            focusedItem === 'total' && { borderWidth: 2, borderColor: theme.colors.primary },
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => { setFocusedItem('total'); activeSheet === 'total' ? closeSheet() : openSheet('total'); }}
        >
          <View style={styles.progressHeader}>
            <Text style={[styles.progressLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>
              {t('stats.learned')}: <Text style={[styles.progressNum, { color: theme.colors.text }]}>{learned}</Text>
            </Text>
            <Text style={[styles.progressLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>
              {t('stats.unlearned')}: <Text style={[styles.progressNum, { color: theme.colors.text }]}>{unlearned}</Text>
            </Text>
            <Text style={[styles.progressPct, { color: theme.colors.primary, fontSize: theme.fontSize.lg }]}>{learnedPct}%</Text>
          </View>
          <View style={[styles.progressBarBg, { backgroundColor: theme.colors.progressBg }]}>
            <View style={[styles.progressBarFill, { width: `${learnedPct}%` }]} />
          </View>
        </Pressable>
      </View>

      {/* デッキ別習熟度 */}
      {deckMastery.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}>
            {t('stats.deckMastery')}
          </Text>
          <View style={styles.deckMasteryList}>
            {deckMastery.map((m, idx) => {
              const deck = deckMap[m.deckId];
              if (!deck) return null;
              const isFocused = focusedItem === idx;
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
                  <DeckMasteryRow deck={deck} mastery={m} theme={theme} onPress={() => { setFocusedItem(idx); activeSheet === idx ? closeSheet() : openSheet(idx); }} />
                </View>
              );
            })}
          </View>
        </View>
      )}

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
        shortcuts={STATS_SHORTCUTS}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hiddenKeyboardInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  summarySection: { paddingHorizontal: 16, paddingTop: 16 },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 4 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },

  // Summary row
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryValue: { fontWeight: '700' },
  summaryLabel: { marginTop: 2, textAlign: 'center' },
  streakMedalBadge: { position: 'absolute', top: 2, right: 2 },

  // Section
  section: { marginTop: 16 },
  sectionTitle: { fontWeight: '700', marginBottom: 8 },
  card: {
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },

  // Bar chart
  barChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '60%', borderRadius: 4, minHeight: 0 },
  barCount: {},
  barLabel: {},

  // Progress
  progressHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  progressLabel: { flex: 1 },
  progressNum: { fontWeight: '700' },
  progressPct: { fontWeight: '700' },
  progressBarBg: { height: 10, borderRadius: 5, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#1976D2', borderRadius: 5 },

  // Deck mastery
  deckMasteryList: { gap: 8 },
  masteryRow: { paddingVertical: 10 },
  masteryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  masteryDeckName: { fontWeight: '600', flex: 1, marginRight: 8 },
  masteryPct: { fontWeight: '700' },
  masteryBarBg: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 4 },
  masteryBarFill: { height: '100%', borderRadius: 4 },
  masterySubLabel: {},

});
