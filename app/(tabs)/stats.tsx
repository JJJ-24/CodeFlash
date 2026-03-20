import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { useTheme, type AppTheme } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';
import type { InitialFilterPreference } from '@/store/settings';
import { getAllDecks } from '@/lib/database/decks';
import {
  getDeckMasteryList,
  getLearnedUnlearnedCount,
  getPast7DaysReviewedCount,
  getPast7DaysStudyActivity,
  getStudyStreak,
  getTodayDueCount,
  getTodayReviewedCount,
  getUpcomingSchedule,
} from '@/lib/database/reviews';
import { getPast7DaysCreatedCount } from '@/lib/database/cards';
import type { Deck } from '@/types';

const DAY_LABELS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BAR_MAX_HEIGHT = 60;
const EASE_MIN = 1.3;
const EASE_MAX = 3.0;

function masteryPercent(avgEase: number): number {
  return Math.round(((avgEase - EASE_MIN) / (EASE_MAX - EASE_MIN)) * 100);
}

function masteryColor(pct: number): string {
  if (pct >= 70) return '#4CAF50';
  if (pct >= 40) return '#FF9800';
  return '#E53935';
}

type ScheduleItem = { date: string; count: number };
type MasteryItem = { deckId: string; avgEase: number; learnedCount: number };
type BlockKey = 'streak' | 'learned' | 'due' | 'new';

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
            <Text style={[styles.barCount, { color: theme.colors.textSecondary }]}>
              {item.count > 0 ? item.count : ''}
            </Text>
            <View style={[styles.bar, { height: barH, backgroundColor: color, opacity: isToday ? 1 : 0.35 }]} />
            <Text style={[styles.barLabel, { color: theme.colors.textTertiary }, isToday && { color, fontWeight: '700' }]}>
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
        <Text style={[styles.masteryDeckName, { color: theme.colors.text }]} numberOfLines={1}>
          {deck.name}
        </Text>
        <Text style={[styles.masteryPct, { color }]}>{pct}%</Text>
      </View>
      <View style={[styles.masteryBarBg, { backgroundColor: theme.colors.progressBg }]}>
        <View style={[styles.masteryBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.masterySubLabel, { color: theme.colors.textTertiary }]}>
        {t('stats.learned')}: {mastery.learnedCount} {t('stats.cards')}
      </Text>
    </Pressable>
  );
}

/** 過去7日分を昇順で埋める（欠落日は count: 0、今日が最後） */
function fillPast7Days(rows: ScheduleItem[]): ScheduleItem[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().slice(0, 10);
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
  const [todayReviewed, setTodayReviewed] = useState(0);
  const [todayDue, setTodayDue] = useState(0);
  const [streak, setStreak] = useState(0);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [past7DaysReviewed, setPast7DaysReviewed] = useState<ScheduleItem[]>([]);
  const [past7DaysActivity, setPast7DaysActivity] = useState<ScheduleItem[]>([]);
  const [past7DaysCreated, setPast7DaysCreated] = useState<ScheduleItem[]>([]);
  const [learned, setLearned] = useState(0);
  const [unlearned, setUnlearned] = useState(0);
  const [deckMastery, setDeckMastery] = useState<MasteryItem[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);

  useFocusEffect(
    useCallback(() => {
      const blockMap: Record<InitialFilterPreference, BlockKey | null> = {
        all: 'streak', learned: 'learned', review: 'due', new: 'new', none: null,
      };
      const initial = blockMap[initialFilterPreference];
      if (initial !== null) setSelectedBlock(initial);
      async function load() {
        const [reviewed, due, s, rawSchedule, counts, mastery, allDecks, rawReviewed, rawActivity, rawCreated] =
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
          ]);

        setTodayReviewed(reviewed);
        setTodayDue(due);
        setStreak(s);
        setLearned(counts.learned);
        setUnlearned(counts.unlearned);
        setDeckMastery(mastery);
        setDecks(allDecks);

        // 今後7日分（今日が先頭）
        const filledSchedule: ScheduleItem[] = Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() + i);
          const dateStr = d.toISOString().slice(0, 10);
          const found = rawSchedule.find((r) => r.date === dateStr);
          return { date: dateStr, count: found?.count ?? 0 };
        });
        setSchedule(filledSchedule);

        // 過去7日分（今日が末尾）
        setPast7DaysReviewed(fillPast7Days(rawReviewed));
        setPast7DaysActivity(fillPast7Days(rawActivity));
        setPast7DaysCreated(fillPast7Days(rawCreated));
      }
      load();
    }, [db, initialFilterPreference])
  );

  const hasData = learned > 0 || todayReviewed > 0;
  const total = learned + unlearned;
  const learnedPct = total > 0 ? Math.round((learned / total) * 100) : 0;

  if (!hasData && total === 0) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: theme.colors.background }]}>
        <Ionicons name="bar-chart-outline" size={72} color={theme.colors.iconSubtle} />
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
          {t('stats.empty')}
        </Text>
        <Text style={[styles.emptySubText, { color: theme.colors.textTertiary }]}>
          {t('stats.emptySub')}
        </Text>
      </View>
    );
  }

  // デッキIDでデッキを引く map
  const deckMap = Object.fromEntries(decks.map((d) => [d.id, d]));

  const blockColors: Record<BlockKey, string> = {
    streak: theme.colors.primary,
    learned: '#4CAF50',
    due: '#F57C00',
    new: theme.colors.textSecondary,
  };

  const chartConfig: { data: ScheduleItem[]; title: string; color: string; todayIsLast: boolean } =
    selectedBlock === 'learned'
      ? { data: past7DaysReviewed, title: t('stats.past7DaysReviewed'), color: '#4CAF50', todayIsLast: true }
      : selectedBlock === 'streak'
        ? { data: past7DaysActivity, title: t('stats.past7DaysActivity'), color: theme.colors.primary, todayIsLast: true }
        : selectedBlock === 'new'
          ? { data: past7DaysCreated, title: t('stats.past7DaysCreated'), color: theme.colors.textSecondary, todayIsLast: true }
          : { data: schedule, title: t('stats.upcomingSchedule'), color: '#F57C00', todayIsLast: false };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* サマリーカード row */}
      <View style={styles.summaryRow}>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface },
            selectedBlock === 'streak' && { borderWidth: 2, borderColor: blockColors.streak },
          ]}
          onPress={() => setSelectedBlock('streak')}
        >
          <Text style={[styles.summaryValue, { color: theme.colors.primary }]}>
            {streak}
          </Text>
          <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            {t('stats.streak')}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface },
            selectedBlock === 'learned' && { borderWidth: 2, borderColor: blockColors.learned },
          ]}
          onPress={() => setSelectedBlock('learned')}
        >
          <Text style={[styles.summaryValue, { color: '#4CAF50' }]}>{todayReviewed}</Text>
          <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center' }]}>{t('stats.learned')}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface },
            selectedBlock === 'due' && { borderWidth: 2, borderColor: blockColors.due },
          ]}
          onPress={() => setSelectedBlock('due')}
        >
          <Text style={[styles.summaryValue, { color: '#F57C00' }]}>{todayDue}</Text>
          <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center' }]}>{t('stats.statDue')}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.summaryCard,
            { backgroundColor: theme.colors.surface },
            selectedBlock === 'new' && { borderWidth: 2, borderColor: blockColors.new },
          ]}
          onPress={() => setSelectedBlock('new')}
        >
          <Text style={[styles.summaryValue, { color: theme.colors.textSecondary }]}>{unlearned}</Text>
          <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary, textAlign: 'center' }]}>{t('stats.unlearned')}</Text>
        </Pressable>
      </View>

      {/* 7日間バーチャート */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
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

      {/* 全体進捗 */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
          {t('stats.totalProgress')}
        </Text>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.progressHeader}>
            <Text style={[styles.progressLabel, { color: theme.colors.textSecondary }]}>
              {t('stats.learned')}: <Text style={[styles.progressNum, { color: theme.colors.text }]}>{learned}</Text>
            </Text>
            <Text style={[styles.progressLabel, { color: theme.colors.textSecondary }]}>
              {t('stats.unlearned')}: <Text style={[styles.progressNum, { color: theme.colors.text }]}>{unlearned}</Text>
            </Text>
            <Text style={[styles.progressPct, { color: theme.colors.primary }]}>{learnedPct}%</Text>
          </View>
          <View style={[styles.progressBarBg, { backgroundColor: theme.colors.progressBg }]}>
            <View style={[styles.progressBarFill, { width: `${learnedPct}%` }]} />
          </View>
        </View>
      </View>

      {/* デッキ別習熟度 */}
      {deckMastery.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
            {t('stats.deckMastery')}
          </Text>
          <View style={styles.deckMasteryList}>
            {deckMastery.map((m) => {
              const deck = deckMap[m.deckId];
              if (!deck) return null;
              return (
                <View key={m.deckId} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                  <DeckMasteryRow deck={deck} mastery={m} theme={theme} onPress={() => setSelectedMastery(m)} />
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* デッキ詳細モーダル（プレースホルダー） */}
      <Modal
        visible={selectedMastery !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedMastery(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedMastery(null)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                {deckMap[selectedMastery?.deckId ?? '']?.name ?? ''}
              </Text>
              <Pressable onPress={() => setSelectedMastery(null)} style={styles.modalCloseBtn}>
                <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
              </Pressable>
            </View>
            <View style={{ padding: 16 }}>
              <Text style={{ color: theme.colors.textTertiary }}>{/* 表示内容は後で追加 */}</Text>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 4, paddingBottom: 32 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 18, fontWeight: '600' },
  emptySubText: { fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },

  // Summary row
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryCardHighlight: { backgroundColor: '#1976D2' },
  summaryValue: { fontSize: 26, fontWeight: '700' },
  summaryValueHighlight: { color: '#FFF' },
  summaryLabelHighlight: { color: 'rgba(255,255,255,0.85)' },
  summaryLabel: { fontSize: 12, marginTop: 2, textAlign: 'center' },
  summaryUnit: { fontSize: 11 },

  // Section
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
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
  barCount: { fontSize: 10, height: 14 },
  barLabel: { fontSize: 11 },

  // Progress
  progressHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  progressLabel: { fontSize: 13, flex: 1 },
  progressNum: { fontWeight: '700' },
  progressPct: { fontSize: 18, fontWeight: '700' },
  progressBarBg: { height: 10, borderRadius: 5, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#1976D2', borderRadius: 5 },

  // Deck mastery
  deckMasteryList: { gap: 8 },
  masteryRow: { paddingVertical: 10 },
  masteryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  masteryDeckName: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  masteryPct: { fontSize: 14, fontWeight: '700' },
  masteryBarBg: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 4 },
  masteryBarFill: { height: '100%', borderRadius: 4 },
  masterySubLabel: { fontSize: 11 },
  divider: { height: 1 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalCloseBtn: { padding: 4 },
});
