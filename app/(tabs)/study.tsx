import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useTheme } from '@/lib/theme';
import {
  getDueCountPerDeck,
  getDueCountPerTag,
  getTodayReviewedCountPerDeck,
  getTodayReviewedCountPerTag,
  getReviewDueCountPerDeck,
  getReviewDueCountPerTag,
  getUnlearnedCountPerDeck,
  getUnlearnedCountPerTag,
  getTotalCardCountPerTag,
} from '@/lib/database/reviews';
import { useDeckStore } from '@/store/decks';
import { useTagStore } from '@/store/tags';
import { getAllDecks } from '@/lib/database/decks';
import { getAllTags } from '@/lib/database/tags';
import type { Deck, Tag } from '@/types';

type Tab = 'decks' | 'tags';
type Filter = 'all' | 'learned' | 'review' | 'new';

const SESSION_FILTER_MAP: Record<Filter, 'all' | 'today' | 'due' | 'unlearned'> = {
  all: 'all',
  learned: 'today',
  review: 'due',
  new: 'unlearned',
};

function sumValues(map: Record<string, number>): number {
  return Object.values(map).reduce((s, v) => s + v, 0);
}

export default function StudyScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { decks, setDecks } = useDeckStore();
  const { tags, setTags } = useTagStore();

  const [dueCounts, setDueCounts] = useState<Record<string, number>>({});
  const [tagDueCounts, setTagDueCounts] = useState<Record<string, number>>({});
  const [todayReviewedPerDeck, setTodayReviewedPerDeck] = useState<Record<string, number>>({});
  const [todayReviewedPerTag, setTodayReviewedPerTag] = useState<Record<string, number>>({});
  const [reviewDuePerDeck, setReviewDuePerDeck] = useState<Record<string, number>>({});
  const [reviewDuePerTag, setReviewDuePerTag] = useState<Record<string, number>>({});
  const [unlearnedPerDeck, setUnlearnedPerDeck] = useState<Record<string, number>>({});
  const [unlearnedPerTag, setUnlearnedPerTag] = useState<Record<string, number>>({});
  const [totalPerTag, setTotalPerTag] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('decks');
  const [activeFilter, setActiveFilter] = useState<Filter>('review');

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        const [
          loadedDecks, deckCounts, loadedTags, tagCounts,
          todayDeck, todayTag, reviewDeck, reviewTag,
          unlearnedDeck, unlearnedTag, totalTag,
        ] = await Promise.all([
          getAllDecks(db),
          getDueCountPerDeck(db),
          getAllTags(db),
          getDueCountPerTag(db),
          getTodayReviewedCountPerDeck(db),
          getTodayReviewedCountPerTag(db),
          getReviewDueCountPerDeck(db),
          getReviewDueCountPerTag(db),
          getUnlearnedCountPerDeck(db),
          getUnlearnedCountPerTag(db),
          getTotalCardCountPerTag(db),
        ]);
        setDecks(loadedDecks);
        setDueCounts(deckCounts);
        setTags(loadedTags);
        setTagDueCounts(tagCounts);
        setTodayReviewedPerDeck(todayDeck);
        setTodayReviewedPerTag(todayTag);
        setReviewDuePerDeck(reviewDeck);
        setReviewDuePerTag(reviewTag);
        setUnlearnedPerDeck(unlearnedDeck);
        setUnlearnedPerTag(unlearnedTag);
        setTotalPerTag(totalTag);
        setLoading(false);
      })();
    }, [db])
  );

  // フィルター別: デッキの表示カウント・テキスト・タップ可否を返す
  function getDeckDisplayInfo(deck: Deck): {
    count: number;
    subText: string;
    subTextActive: boolean;
    tappable: boolean;
  } {
    switch (activeFilter) {
      case 'all': {
        const n = deck.cardCount;
        return {
          count: n,
          subText: n > 0 ? `${n}枚がすべてのカード` : 'カードがありません',
          subTextActive: n > 0,
          tappable: n > 0,
        };
      }
      case 'learned': {
        const n = todayReviewedPerDeck[deck.id] ?? 0;
        return {
          count: n,
          subText: n > 0 ? `${n}枚が学習済み対象` : '今日の学習済みはありません',
          subTextActive: n > 0,
          tappable: n > 0,
        };
      }
      case 'review': {
        const n = dueCounts[deck.id] ?? 0;
        return {
          count: n,
          subText: n > 0 ? t('study.dueCards', { count: n }) : t('study.noDue'),
          subTextActive: n > 0,
          tappable: n > 0,
        };
      }
      case 'new': {
        const n = unlearnedPerDeck[deck.id] ?? 0;
        return {
          count: n,
          subText: n > 0 ? `${n}枚が未学習対象` : '未学習はありません',
          subTextActive: n > 0,
          tappable: n > 0,
        };
      }
    }
  }

  // フィルター別: タグの表示カウント・テキスト・タップ可否を返す
  function getTagDisplayInfo(tag: Tag): {
    count: number;
    subText: string;
    subTextActive: boolean;
    tappable: boolean;
  } {
    switch (activeFilter) {
      case 'all': {
        const n = totalPerTag[tag.id] ?? 0;
        return {
          count: n,
          subText: n > 0 ? `${n}枚がすべてのカード` : 'カードがありません',
          subTextActive: n > 0,
          tappable: n > 0,
        };
      }
      case 'learned': {
        const n = todayReviewedPerTag[tag.id] ?? 0;
        return {
          count: n,
          subText: n > 0 ? `${n}枚が学習済み対象` : '今日の学習済みはありません',
          subTextActive: n > 0,
          tappable: n > 0,
        };
      }
      case 'review': {
        const n = tagDueCounts[tag.id] ?? 0;
        return {
          count: n,
          subText: n > 0 ? t('study.dueCards', { count: n }) : t('study.noDue'),
          subTextActive: n > 0,
          tappable: n > 0,
        };
      }
      case 'new': {
        const n = unlearnedPerTag[tag.id] ?? 0;
        return {
          count: n,
          subText: n > 0 ? `${n}枚が未学習対象` : '未学習はありません',
          subTextActive: n > 0,
          tappable: n > 0,
        };
      }
    }
  }

  const totalAll = activeTab === 'decks'
    ? decks.reduce((s, d) => s + d.cardCount, 0)
    : sumValues(totalPerTag);
  const totalLearned = activeTab === 'decks' ? sumValues(todayReviewedPerDeck) : sumValues(todayReviewedPerTag);
  const totalReview = activeTab === 'decks' ? sumValues(dueCounts) : sumValues(tagDueCounts);
  const totalNew = activeTab === 'decks' ? sumValues(unlearnedPerDeck) : sumValues(unlearnedPerTag);

  const filterBlocks: { key: Filter; value: number; color: string; label: string }[] = [
    { key: 'all', value: totalAll, color: theme.colors.primary, label: t('stats.all') },
    { key: 'learned', value: totalLearned, color: '#4CAF50', label: t('stats.learned') },
    { key: 'review', value: totalReview, color: '#F57C00', label: t('stats.statDue') },
    { key: 'new', value: totalNew, color: theme.colors.textSecondary, label: t('stats.unlearned') },
  ];

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* フィルターブロック */}
      <View style={styles.filterSection}>
        <View style={styles.summaryRow}>
          {filterBlocks.map((block) => {
            const selected = activeFilter === block.key;
            return (
              <Pressable
                key={block.key}
                style={[
                  styles.summaryCard,
                  { backgroundColor: theme.colors.surface },
                  selected && { borderWidth: 2, borderColor: block.color },
                ]}
                onPress={() => setActiveFilter(block.key)}
              >
                <Text style={[styles.summaryValue, { color: block.color }]}>{block.value}</Text>
                <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary }]}>
                  {block.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
          {t('study.listTitle')}
        </Text>
      </View>

      {/* タブバー */}
      <View style={[styles.tabBar, { borderBottomColor: theme.colors.border }]}>
        {(['decks', 'tags'] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[
              styles.tab,
              activeTab === tab && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 },
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeTab === tab ? theme.colors.primary : theme.colors.textTertiary },
              ]}
            >
              {t(tab === 'decks' ? 'study.selectDeck' : 'study.selectTag')}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* デッキタブ */}
      {activeTab === 'decks' && (
        decks.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="book-outline" size={56} color={theme.colors.iconSubtle} />
            <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
              {t('study.noDecks')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={decks}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
            )}
            renderItem={({ item }) => {
              const { count, subText, subTextActive, tappable } = getDeckDisplayInfo(item);
              return (
                <Pressable
                  style={[
                    styles.deckRow,
                    { backgroundColor: theme.colors.surface },
                    !tappable && styles.deckRowDimmed,
                  ]}
                  onPress={() => {
                    if (!tappable) return;
                    router.push({ pathname: '/study/session', params: { deckId: item.id, filter: SESSION_FILTER_MAP[activeFilter] } });
                  }}
                >
                  <View style={styles.deckInfo}>
                    <Text style={[styles.deckName, { color: theme.colors.text }]}>{item.name}</Text>
                    <Text style={[styles.dueLabel, { color: theme.colors.textTertiary }, subTextActive && styles.dueLabelActive]}>
                      {subText}
                    </Text>
                  </View>
                  {count > 0 && (
                    <View style={styles.dueChip}>
                      <Text style={styles.dueChipText}>{count}</Text>
                    </View>
                  )}
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={tappable ? theme.colors.iconSubtle : theme.colors.border}
                  />
                </Pressable>
              );
            }}
          />
        )
      )}

      {/* タグタブ */}
      {activeTab === 'tags' && (
        tags.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="pricetag-outline" size={56} color={theme.colors.iconSubtle} />
            <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
              {t('study.noTags')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={tags}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
            )}
            renderItem={({ item }) => {
              const { count, subText, subTextActive, tappable } = getTagDisplayInfo(item);
              return (
                <Pressable
                  style={[
                    styles.deckRow,
                    { backgroundColor: theme.colors.surface },
                    !tappable && styles.deckRowDimmed,
                  ]}
                  onPress={() => {
                    if (!tappable) return;
                    router.push({ pathname: '/study/session', params: { tagId: item.id, filter: SESSION_FILTER_MAP[activeFilter] } });
                  }}
                >
                  <View style={[styles.tagColorDot, { backgroundColor: item.color }]} />
                  <View style={styles.deckInfo}>
                    <Text style={[styles.deckName, { color: theme.colors.text }]}>{item.name}</Text>
                    <Text style={[styles.dueLabel, { color: theme.colors.textTertiary }, subTextActive && styles.dueLabelActive]}>
                      {subText}
                    </Text>
                  </View>
                  {count > 0 && (
                    <View style={styles.dueChip}>
                      <Text style={styles.dueChipText}>{count}</Text>
                    </View>
                  )}
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={tappable ? theme.colors.iconSubtle : theme.colors.border}
                  />
                </Pressable>
              );
            }}
          />
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 16 },

  filterSection: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 24 },
  summaryRow: { flexDirection: 'row', gap: 8 },
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
  summaryValue: { fontSize: 26, fontWeight: '700' },
  summaryLabel: { fontSize: 12, marginTop: 2, textAlign: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '700' },

  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { fontSize: 14, fontWeight: '600' },
  list: { paddingHorizontal: 16 },
  separator: { height: 1 },
  deckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  deckRowDimmed: { opacity: 0.5 },
  deckInfo: { flex: 1, gap: 3 },
  deckName: { fontSize: 16, fontWeight: '600' },
  dueLabel: { fontSize: 13 },
  dueLabelActive: { color: '#1976D2' },
  dueChip: {
    backgroundColor: '#1976D2',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 28,
    alignItems: 'center',
  },
  dueChipText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  tagColorDot: { width: 16, height: 16, borderRadius: 8 },
});
