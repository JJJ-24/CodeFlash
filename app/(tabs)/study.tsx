import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { useTheme, FILTER_COLORS } from '@/lib/theme';
import {
  getDueCountPerDeck,
  getDueCountPerTag,
  getTodayReviewedCountPerDeck,
  getTodayReviewedCountPerTag,
  getTotalCardCountPerTag,
} from '@/lib/database/reviews';
import {
  getTodayCreatedCountPerDeck,
  getTodayCreatedCountPerTag,
} from '@/lib/database/cards';
import { useDeckStore } from '@/store/decks';
import { useTagStore } from '@/store/tags';
import { useSettingsStore, SESSION_FILTER_MAP, preferenceToFilter } from '@/store/settings';
import { getAllDecks } from '@/lib/database/decks';
import { getAllTags } from '@/lib/database/tags';
import type { Deck, Tag } from '@/types';

type Tab = 'decks' | 'tags';
type Filter = 'all' | 'learned' | 'review' | 'new';

function sumValues(map: Record<string, number>): number {
  return Object.values(map).reduce((s, v) => s + v, 0);
}

const STUDY_TAB_SHORTCUTS = [
  { key: '1–4',   descKey: 'settings.shortcutFilterSwitch' },
  { key: 'T / Y',   descKey: 'settings.shortcutFocusNextPrev' },
  { key: 'Return', descKey: 'settings.shortcutStartStudyFocused' },
  { key: 'S',     descKey: 'settings.shortcutToggleShuffle' },
  { key: 'Q',     descKey: 'settings.shortcutToggleTab' },
];

export default function StudyScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const theme = useTheme();
  const { decks, setDecks } = useDeckStore();
  const { tags, setTags } = useTagStore();
  const { initialFilterPreference, shuffleEnabled, setShuffleEnabled, keyboardShortcutsEnabled, deckSortOrder } = useSettingsStore();

  const [dueCounts, setDueCounts] = useState<Record<string, number>>({});
  const [tagDueCounts, setTagDueCounts] = useState<Record<string, number>>({});
  const [todayReviewedPerDeck, setTodayReviewedPerDeck] = useState<Record<string, number>>({});
  const [todayReviewedPerTag, setTodayReviewedPerTag] = useState<Record<string, number>>({});
  const [todayCreatedPerDeck, setTodayCreatedPerDeck] = useState<Record<string, number>>({});
  const [todayCreatedPerTag, setTodayCreatedPerTag] = useState<Record<string, number>>({});
  const [totalPerTag, setTotalPerTag] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('decks');
  const [activeFilter, setActiveFilter] = useState<Filter>('review');
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [focusedItemIndex, setFocusedItemIndex] = useState<number | null>(null);
  const fromSessionRef = useRef(false);
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();
  const listRef = useRef<FlatList<any>>(null);

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

  useEffect(() => {
    setFocusedItemIndex(null);
  }, [activeTab]);

  useEffect(() => {
    if (focusedItemIndex === null) return;
    listRef.current?.scrollToIndex({ index: focusedItemIndex, animated: true, viewPosition: 0.5 });
  }, [focusedItemIndex]);

  useFocusEffect(
    useCallback(() => {
      if (!fromSessionRef.current) {
        const initial = preferenceToFilter(initialFilterPreference);
        if (initial !== null) setActiveFilter(initial);
      }
      const isFromSession = fromSessionRef.current;
      fromSessionRef.current = false;
      onScreenFocus();
      (async () => {
        if (!isFromSession) setLoading(true);
        const [
          loadedDecks, deckCounts, loadedTags, tagCounts,
          todayDeck, todayTag,
          createdDeck, createdTag, totalTag,
        ] = await Promise.all([
          getAllDecks(db),
          getDueCountPerDeck(db),
          getAllTags(db),
          getDueCountPerTag(db),
          getTodayReviewedCountPerDeck(db),
          getTodayReviewedCountPerTag(db),
          getTodayCreatedCountPerDeck(db),
          getTodayCreatedCountPerTag(db),
          getTotalCardCountPerTag(db),
        ]);
        setDecks(loadedDecks);
        setDueCounts(deckCounts);
        setTags(loadedTags);
        setTagDueCounts(tagCounts);
        setTodayReviewedPerDeck(todayDeck);
        setTodayReviewedPerTag(todayTag);
        setTodayCreatedPerDeck(createdDeck);
        setTodayCreatedPerTag(createdTag);
        setTotalPerTag(totalTag);
        setLoading(false);
      })();
      return () => { onScreenBlur(); };
    }, [db, initialFilterPreference])
  );

  function makeDisplayInfo(n: number) {
    return { count: n, subText: n > 0 ? t('study.targetCards', { count: n }) : t('study.noTarget'), subTextActive: n > 0, tappable: n > 0 };
  }

  function getDeckDisplayInfo(deck: Deck) {
    const counts: Record<Filter, number> = {
      all: deck.cardCount,
      learned: todayReviewedPerDeck[deck.id] ?? 0,
      review: dueCounts[deck.id] ?? 0,
      new: todayCreatedPerDeck[deck.id] ?? 0,
    };
    return makeDisplayInfo(counts[activeFilter]);
  }

  function getTagDisplayInfo(tag: Tag) {
    const counts: Record<Filter, number> = {
      all: totalPerTag[tag.id] ?? 0,
      learned: todayReviewedPerTag[tag.id] ?? 0,
      review: tagDueCounts[tag.id] ?? 0,
      new: todayCreatedPerTag[tag.id] ?? 0,
    };
    return makeDisplayInfo(counts[activeFilter]);
  }

  function handleKeyPress({ nativeEvent: { key } }: { nativeEvent: { key: string } }) {
    if (!keyboardShortcutsEnabled) return;
    if (key === '1') { setActiveFilter('all'); }
    else if (key === '2') { setActiveFilter('learned'); }
    else if (key === '3') { setActiveFilter('review'); }
    else if (key === '4') { setActiveFilter('new'); }
    else if (key === 's' || key === 'S') { setShuffleEnabled(!shuffleEnabled); }
    else if (key === 'q' || key === 'Q') {
      setActiveTab(prev => prev === 'decks' ? 'tags' : 'decks');
    }
    else if (key === 't' || key === 'T') {
      const items = activeTab === 'decks' ? sortedDecks : tags;
      setFocusedItemIndex(prev => {
        if (prev === null) return items.length > 0 ? 0 : null;
        return prev >= items.length - 1 ? null : prev + 1;
      });
    }
    else if (key === 'y' || key === 'Y') {
      const items = activeTab === 'decks' ? sortedDecks : tags;
      setFocusedItemIndex(prev => {
        if (prev === null) return items.length > 0 ? items.length - 1 : null;
        return prev <= 0 ? null : prev - 1;
      });
    }
  }

  function startStudyFocused() {
    if (!keyboardShortcutsEnabled) return;
    if (focusedItemIndex === null) return;
    const items = activeTab === 'decks' ? sortedDecks : tags;
    const item = items[focusedItemIndex];
    if (!item) return;
    const info = activeTab === 'decks'
      ? getDeckDisplayInfo(item as Deck)
      : getTagDisplayInfo(item as Tag);
    if (!info.tappable) return;
    fromSessionRef.current = true;
    if (activeTab === 'decks') {
      router.push({ pathname: '/study/session', params: { deckId: (item as Deck).id, filter: SESSION_FILTER_MAP[activeFilter], shuffle: shuffleEnabled ? '1' : '0' } });
    } else {
      router.push({ pathname: '/study/session', params: { tagId: (item as Tag).id, filter: SESSION_FILTER_MAP[activeFilter], shuffle: shuffleEnabled ? '1' : '0' } });
    }
  }

  const sortedDecks = useMemo(() => {
    if (deckSortOrder === 'name') return [...decks].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (deckSortOrder === 'cardCount') return [...decks].sort((a, b) => b.cardCount - a.cardCount);
    return decks;
  }, [decks, deckSortOrder]);

  const totalAll = activeTab === 'decks'
    ? decks.reduce((s, d) => s + d.cardCount, 0)
    : sumValues(totalPerTag);
  const totalLearned = activeTab === 'decks' ? sumValues(todayReviewedPerDeck) : sumValues(todayReviewedPerTag);
  const totalReview = activeTab === 'decks' ? sumValues(dueCounts) : sumValues(tagDueCounts);
  const totalNew = activeTab === 'decks' ? sumValues(todayCreatedPerDeck) : sumValues(todayCreatedPerTag);

  const filterDescMap: Record<Filter, string> = {
    all: t('study.filterDescAll'),
    learned: t('study.filterDescLearned'),
    review: t('study.filterDescReview'),
    new: t('study.filterDescNew'),
  };

  const filterBlocks: { key: Filter; value: number; color: string; label: string }[] = [
    { key: 'all', value: totalAll, color: theme.colors.primary, label: t('stats.all') },
    { key: 'learned', value: totalLearned, color: FILTER_COLORS.learned, label: t('stats.learned') },
    { key: 'review', value: totalReview, color: FILTER_COLORS.due, label: t('stats.statDue') },
    { key: 'new', value: totalNew, color: theme.colors.textSecondary, label: t('stats.newToday') },
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
      <Pressable style={{ flex: 1 }} onPress={() => setFocusedItemIndex(null)}>
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
                onPress={() => { setActiveFilter(block.key); }}
              >
                <Text style={[styles.summaryValue, { color: block.color, fontSize: theme.fontSize.xxl }]}>{block.value}</Text>
                <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]}>
                  {block.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.listTitleRow}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
            {t('study.listTitle')}
          </Text>
          <Text style={[styles.filterDesc, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}>
            {filterDescMap[activeFilter]}
          </Text>
          <Pressable
            onPress={() => setShuffleEnabled(!shuffleEnabled)}
            style={[
              styles.shuffleBtn,
              { borderColor: shuffleEnabled ? theme.colors.primary : theme.colors.border },
              shuffleEnabled && { backgroundColor: theme.colors.primary },
            ]}
          >
            <Text style={[
              styles.shuffleBtnText,
              { color: shuffleEnabled ? theme.colors.primaryText : theme.colors.textSecondary, fontSize: theme.fontSize.xs },
            ]}>
              {t('study.shuffle')}
            </Text>
          </Pressable>
        </View>
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
                { color: activeTab === tab ? theme.colors.primary : theme.colors.textTertiary, fontSize: theme.fontSize.md },
              ]}
            >
              {t(tab === 'decks' ? 'study.selectDeck' : 'study.selectTag')}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* デッキタブ */}
      {activeTab === 'decks' && (
        sortedDecks.length === 0 ? (
          <View style={styles.center}>
            <EmptyState icon="book-outline" title={t('study.noDecks')} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={sortedDecks}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            onScrollToIndexFailed={() => {}}
            ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedItemIndex(null)} />}
            renderItem={({ item, index }) => {
              const { count, subText, subTextActive, tappable } = getDeckDisplayInfo(item);
              const isFocused = focusedItemIndex === index;
              return (
                <Pressable
                  style={[
                    styles.deckRow,
                    { backgroundColor: theme.colors.surface },
                    !tappable && styles.deckRowDimmed,
                    isFocused && { borderWidth: 2, borderColor: theme.colors.primary },
                  ]}
                  onPress={() => {
                    if (!tappable) return;
                    setFocusedItemIndex(index);
                    fromSessionRef.current = true;
                    router.push({ pathname: '/study/session', params: { deckId: item.id, filter: SESSION_FILTER_MAP[activeFilter], shuffle: shuffleEnabled ? '1' : '0' } });
                  }}
                >
                  <View style={styles.deckInfo}>
                    <Text numberOfLines={1} style={[styles.deckName, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>{item.name}</Text>
                    {!subTextActive && (
                      <Text style={[styles.dueLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}>
                        {subText}
                      </Text>
                    )}
                  </View>
                  {count > 0 && (
                    <View style={[styles.dueChip, { backgroundColor: theme.colors.primary }, activeFilter !== 'review' && { backgroundColor: theme.dark ? '#4B5563' : '#8B949E' }]}>
                      <Text style={[styles.dueChipText, { fontSize: theme.fontSize.sm }]}>{count}</Text>
                    </View>
                  )}
                  <Ionicons
                    name="play"
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
            <EmptyState icon="pricetag-outline" title={t('study.noTags')} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={tags}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            onScrollToIndexFailed={() => {}}
            ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedItemIndex(null)} />}
            renderItem={({ item, index }) => {
              const { count, subText, subTextActive, tappable } = getTagDisplayInfo(item);
              const isFocused = focusedItemIndex === index;
              return (
                <Pressable
                  style={[
                    styles.deckRow,
                    { backgroundColor: theme.colors.surface },
                    !tappable && styles.deckRowDimmed,
                    isFocused && { borderWidth: 2, borderColor: theme.colors.primary },
                  ]}
                  onPress={() => {
                    if (!tappable) return;
                    setFocusedItemIndex(index);
                    fromSessionRef.current = true;
                    router.push({ pathname: '/study/session', params: { tagId: item.id, filter: SESSION_FILTER_MAP[activeFilter], shuffle: shuffleEnabled ? '1' : '0' } });
                  }}
                >
                  <View style={[styles.tagColorDot, { backgroundColor: item.color }]} />
                  <View style={styles.deckInfo}>
                    <Text numberOfLines={1} style={[styles.deckName, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>{item.name}</Text>
                    {!subTextActive && (
                      <Text style={[styles.dueLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}>
                        {subText}
                      </Text>
                    )}
                  </View>
                  {count > 0 && (
                    <View style={[styles.dueChip, { backgroundColor: theme.colors.primary }, activeFilter !== 'review' && { backgroundColor: theme.dark ? '#4B5563' : '#8B949E' }]}>
                      <Text style={[styles.dueChipText, { fontSize: theme.fontSize.sm }]}>{count}</Text>
                    </View>
                  )}
                  <Ionicons
                    name="play"
                    size={18}
                    color={tappable ? theme.colors.iconSubtle : theme.colors.border}
                  />
                </Pressable>
              );
            }}
          />
        )
      )}

      </Pressable>

      {/* 隠しキーボード入力 */}
      <TextInput
        ref={keyboardRef}
        style={styles.hiddenKeyboardInput}
        showSoftInputOnFocus={false}
        disableKeyboardShortcuts={true}
        keyboardType="ascii-capable"
        onKeyPress={handleKeyPress}
        onSubmitEditing={startStudyFocused}
        onBlur={onInputBlur}
      />

      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        shortcuts={STUDY_TAB_SHORTCUTS}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hiddenKeyboardInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },

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
  summaryValue: { fontWeight: '700' },
  summaryLabel: { marginTop: 2, textAlign: 'center' },
  sectionTitle: { fontWeight: '700' },
  listTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shuffleBtn: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  shuffleBtnText: { fontWeight: '600' },
  filterDesc: { flex: 1 },

  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  deckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  deckRowDimmed: { opacity: 0.5 },
  deckInfo: { flex: 1, gap: 3 },
  deckName: { fontWeight: '600' },
  dueLabel: {},
  dueChip: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 28,
    alignItems: 'center',
  },
  dueChipText: { fontWeight: '700', color: '#FFF' },
  tagColorDot: { width: 16, height: 16, borderRadius: 8 },

});
