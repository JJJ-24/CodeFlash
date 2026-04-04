import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';

import { DONUT_CX, DONUT_CY, DONUT_INNER_R, DONUT_R, DONUT_SIZE, donutArcPath } from '@/lib/donut';
import { useTheme, type AppTheme, FILTER_COLORS, GRADE_COLORS } from '@/lib/theme';
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
import { getPast7DaysCreatedCount, getTodayCreatedCount } from '@/lib/database/cards';
import type { Deck } from '@/types';

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
  return Math.round(((avgEase - EASE_MIN) / (EASE_MAX - EASE_MIN)) * 100);
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

  const slices: PieSlice[] = [
    { value: dist.again,     color: GRADE_COLORS.again, label: t('grade.again') },
    { value: dist.hard,      color: GRADE_COLORS.hard,  label: t('grade.hard') },
    { value: dist.normal,    color: GRADE_COLORS.good,  label: t('grade.good') },
    { value: dist.easy,      color: GRADE_COLORS.easy,  label: t('grade.easy') },
    { value: dist.unlearned, color: '#9E9E9E',           label: t('stats.unlearned') },
  ];

  let cumDeg = 0;

  return (
    <View style={pieStyles.container}>
      {/* ヘッダー: 学習済み / トータル */}
      <Text style={[pieStyles.learnedHeader, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
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
        <SvgText
          x={DONUT_CX}
          y={DONUT_CY + 8}
          textAnchor="middle"
          fontSize={24}
          fontWeight="700"
          fill={theme.colors.primary}
        >
          {total}
        </SvgText>
      </Svg>
      {/* グレード別横並びグリッド */}
      <View style={pieStyles.gradeGrid}>
        {slices.map((slice) => {
          const pct = Math.round((slice.value / total) * 100);
          return (
            <View key={slice.label} style={pieStyles.gradeGridItem}>
              <Text style={[pieStyles.gradeGridCount, { color: slice.color, fontSize: theme.fontSize.lg }]}>
                {slice.value}
              </Text>
              <Text style={[pieStyles.gradeGridLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>
                {slice.label}
              </Text>
              <Text style={[pieStyles.gradeGridPct, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>
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
  gradeGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16, paddingTop: 4, paddingBottom: 4, width: '100%' },
  gradeGridItem: { alignItems: 'center', gap: 2, minWidth: 52 },
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

  return (
    <View style={styles.barChart}>
      {schedule.map((item, i) => {
        const barH = Math.max((item.count / maxCount) * BAR_MAX_HEIGHT, item.count > 0 ? 4 : 0);
        const dayIndex = new Date(item.date + 'T00:00:00').getDay();
        const isToday = todayIsLast ? i === schedule.length - 1 : i === 0;

        return (
          <View key={item.date} style={styles.barCol}>
            <Text style={[styles.barCount, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]}>
              {item.count > 0 ? item.count : ''}
            </Text>
            <View style={[styles.bar, { height: barH, backgroundColor: color, opacity: isToday ? 1 : 0.35 }]} />
            <Text style={[styles.barLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }, isToday && { color, fontWeight: '700' }]}>
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

export default function StatsScreen() {
  const db = useSQLiteContext();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { initialFilterPreference } = useSettingsStore();

  const [selectedBlock, setSelectedBlock] = useState<BlockKey>('due');
  const [selectedMastery, setSelectedMastery] = useState<MasteryItem | null>(null);
  const [gradeDistribution, setGradeDistribution] = useState<GradeDistribution | null>(null);
  const [showTotalModal, setShowTotalModal] = useState(false);
  const [totalDistribution, setTotalDistribution] = useState<GradeDistribution | null>(null);
  const [stats, setStats] = useState<StatsData>(INITIAL_STATS);
  const { todayReviewed, todayDue, streak, learned, unlearned, todayCreated,
          schedule, past7DaysReviewed, past7DaysActivity, past7DaysCreated,
          deckMastery, decks, heatmapData } = stats;

  useFocusEffect(
    useCallback(() => {
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
    }, [db, initialFilterPreference])
  );

  const openMasteryModal = useCallback(async (m: MasteryItem) => {
    setSelectedMastery(m);
    setGradeDistribution(null);
    const dist = await getDeckGradeDistribution(db, m.deckId);
    setGradeDistribution(dist);
  }, [db]);

  const openTotalModal = useCallback(async () => {
    setShowTotalModal(true);
    setTotalDistribution(null);
    const dist = await getAllGradeDistribution(db);
    setTotalDistribution(dist);
  }, [db]);

  const hasData = learned > 0 || todayReviewed > 0;
  const total = learned + unlearned;
  const learnedPct = total > 0 ? Math.round((learned / total) * 100) : 0;

  if (!hasData && total === 0) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: theme.colors.background }]}>
        <Ionicons name="bar-chart-outline" size={64} color={theme.colors.iconSubtle} />
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
          {t('stats.empty')}
        </Text>
        <Text style={[styles.emptySubText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}>
          {t('stats.emptySub')}
        </Text>
      </View>
    );
  }

  // デッキIDでデッキを引く map
  const deckMap = Object.fromEntries(decks.map((d) => [d.id, d]));

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
      <View style={[styles.summarySection, { backgroundColor: theme.colors.background }]}>
        <View style={styles.summaryRow}>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.primary },
            selectedBlock === 'streak' && { borderWidth: 2, borderColor: blockColors.streak },
          ]}
          onPress={() => setSelectedBlock('streak')}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryValue, { color: '#FFF', fontSize: theme.fontSize.xxl }]}>
            {streak}
          </Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: 'rgba(255,255,255,0.85)', textAlign: 'center', fontSize: theme.fontSize.xs }]}>
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
          onPress={() => setSelectedBlock('learned')}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryValue, { color: FILTER_COLORS.learned, fontSize: theme.fontSize.xxl }]}>{todayReviewed}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center', fontSize: theme.fontSize.xs }]}>{t('stats.learned')}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface },
            selectedBlock === 'due' && { borderWidth: 2, borderColor: blockColors.due },
          ]}
          onPress={() => setSelectedBlock('due')}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryValue, { color: FILTER_COLORS.due, fontSize: theme.fontSize.xxl }]}>{todayDue}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center', fontSize: theme.fontSize.xs }]}>{t('stats.statDue')}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface },
            selectedBlock === 'new' && { borderWidth: 2, borderColor: blockColors.new },
          ]}
          onPress={() => setSelectedBlock('new')}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryValue, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xxl }]}>{todayCreated}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center', fontSize: theme.fontSize.xs }]}>{t('stats.newToday')}</Text>
        </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>

      {/* 7日間バーチャート */}
      <View style={styles.section}>
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
      </View>

      {/* 学習履歴（草グラフ） */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}>
          {t('stats.activityHeatmap')}
        </Text>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <ActivityHeatmap data={heatmapData} />
        </View>
      </View>

      {/* 全体学習率 */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}>
          {t('stats.totalProgress')}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.card, { backgroundColor: theme.colors.surface }, pressed && { opacity: 0.7 }]}
          onPress={openTotalModal}
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
            {deckMastery.map((m) => {
              const deck = deckMap[m.deckId];
              if (!deck) return null;
              return (
                <View key={m.deckId} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                  <DeckMasteryRow deck={deck} mastery={m} theme={theme} onPress={() => openMasteryModal(m)} />
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* 全体進捗モーダル */}
      <Modal
        visible={showTotalModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTotalModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowTotalModal(false)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>
                {t('stats.totalProgress')}
              </Text>
              <Pressable onPress={() => setShowTotalModal(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
              </Pressable>
            </View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              {totalDistribution ? (
                <GradeDistPieChart dist={totalDistribution} theme={theme} />
              ) : (
                <Text style={{ color: theme.colors.textTertiary, textAlign: 'center', paddingVertical: 16 }}>
                  {t('common.loading')}
                </Text>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* デッキ詳細モーダル */}
      <Modal
        visible={selectedMastery !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedMastery(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedMastery(null)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>
                {deckMap[selectedMastery?.deckId ?? '']?.name ?? ''}
              </Text>
              <Pressable onPress={() => setSelectedMastery(null)} style={styles.modalCloseBtn}>
                <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
              </Pressable>
            </View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              {gradeDistribution ? (
                <GradeDistPieChart dist={gradeDistribution} theme={theme} />
              ) : (
                <Text style={{ color: theme.colors.textTertiary, textAlign: 'center', paddingVertical: 16 }}>
                  {t('common.loading')}
                </Text>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  summarySection: { paddingHorizontal: 16, paddingTop: 16 },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 4 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { fontWeight: '600' },
  emptySubText: { textAlign: 'center', paddingHorizontal: 40 },

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
  barChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: BAR_MAX_HEIGHT + 44 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '60%', borderRadius: 4, minHeight: 0 },
  barCount: { height: 14 },
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

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  modalTitle: { fontWeight: '700' },
  modalCloseBtn: { padding: 4 },
});
