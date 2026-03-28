import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { FlatList } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useTheme, FILTER_COLORS } from '@/lib/theme';
import {
  deleteCard,
  getCardsByDeckId,
  getTodayCreatedCardIdsByDeckId,
  getTodayCreatedCountByDeck,
  updateCardSortOrders,
} from '@/lib/database/cards';
import {
  getDueCardIdsByDeckId,
  getDueCountByDeck,
  getTodayReviewedCardIdsByDeckId,
  getTodayReviewedCountByDeck,
} from '@/lib/database/reviews';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';
import { useSettingsStore } from '@/store/settings';
import type { DeckDetailFilter } from '@/store/settings';
import type { Block, Card } from '@/types';

type FilterKey = DeckDetailFilter;

const SESSION_FILTER_MAP: Record<FilterKey, 'all' | 'today' | 'due' | 'unlearned'> = {
  all: 'all',
  learned: 'today',
  review: 'due',
  new: 'unlearned',
};

function getPreviewText(blocks: Block[]): string {
  const first = blocks.find((b) => b.type === 'text');
  return first?.content?.trim() ?? '';
}

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { decks, updateDeck } = useDeckStore();
  const { cards, setCards, removeCard, reorderCards } = useCardStore();
  const { initialFilterPreference, lastDeckDetailFilter, setLastDeckDetailFilter } = useSettingsStore();
  const [todayReviewed, setTodayReviewed] = useState(0);
  const [dueCount, setDueCount] = useState(0);
  const [todayCreatedCount, setTodayCreatedCount] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>(() => {
    if (initialFilterPreference === 'none') return lastDeckDetailFilter;
    const filterMap: Record<string, FilterKey> = {
      all: 'all', learned: 'learned', review: 'review', new: 'new',
    };
    return filterMap[initialFilterPreference] ?? 'review';
  });
  const keyboardRef = useRef<TextInput>(null);
  const isScreenFocusedRef = useRef(false);
  const listRef = useRef<FlatList<Card>>(null);
  const scrollOffsetRef = useRef(0);
  const SCROLL_STEP = 200;
  const [filterCardIds, setFilterCardIds] = useState<Record<FilterKey, Set<string>>>({
    all: new Set(),
    learned: new Set(),
    review: new Set(),
    new: new Set(),
  });

  const deck = decks.find((d) => d.id === id) ?? null;

  const loadCards = useCallback(async () => {
    const [loaded, reviewed, due, todayCreated, todayIds, dueIds, todayCreatedIds] = await Promise.all([
      getCardsByDeckId(db, id),
      getTodayReviewedCountByDeck(db, id),
      getDueCountByDeck(db, id),
      getTodayCreatedCountByDeck(db, id),
      getTodayReviewedCardIdsByDeckId(db, id),
      getDueCardIdsByDeckId(db, id),
      getTodayCreatedCardIdsByDeckId(db, id),
    ]);
    setCards(loaded);
    setTodayReviewed(reviewed);
    setDueCount(due);
    setTodayCreatedCount(todayCreated);
    setFilterCardIds({
      all: new Set(loaded.map((c) => c.id)),
      learned: new Set(todayIds),
      review: new Set(dueIds),
      new: new Set(todayCreatedIds),
    });
  }, [db, id, setCards]);

  useFocusEffect(
    useCallback(() => {
      if (!deck) {
        router.back();
        return;
      }
      isScreenFocusedRef.current = true;
      loadCards();
      setTimeout(() => keyboardRef.current?.focus(), 100);
      return () => { isScreenFocusedRef.current = false; };
    }, [loadCards])
  );

  // deck が削除された後（編集モーダルから削除時）に自動で戻る
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!deck) router.back();
  }, [deck]);

  function confirmDeleteCard(card: Card) {
    Alert.alert(t('card.delete'), t('card.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteCard(db, card.id, id);
          removeCard(card.id);
          if (deck) {
            updateDeck({ ...deck, cardCount: Math.max(deck.cardCount - 1, 0) });
          }
          loadCards();
        },
      },
    ]);
  }

  if (!deck) return null;

  const deckCards = cards.filter((c) => c.deckId === id);
  const displayedCards = selectedFilter === 'all'
    ? deckCards
    : deckCards.filter((c) => filterCardIds[selectedFilter].has(c.id));

  const filterItems: { key: FilterKey; count: number; color: string; label: string }[] = [
    { key: 'all', count: deck.cardCount, color: theme.colors.primary, label: t('stats.all') },
    { key: 'learned', count: todayReviewed, color: FILTER_COLORS.learned, label: t('stats.learned') },
    { key: 'review', count: dueCount, color: FILTER_COLORS.due, label: t('stats.statDue') },
    { key: 'new', count: todayCreatedCount, color: theme.colors.textSecondary, label: t('stats.newToday') },
  ];

  const filterDescMap: Record<FilterKey, string> = {
    all: t('study.filterDescAll'),
    learned: t('study.filterDescLearned'),
    review: t('study.filterDescReview'),
    new: t('study.filterDescNew'),
  };

  const ListHeader = (
    <>
      {deck.description ? (
        <Text style={[styles.description, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}>
          {deck.description}
        </Text>
      ) : null}

      <View style={styles.statsRow}>
        {filterItems.map(({ key, count, color, label }) => {
          const isSelected = selectedFilter === key;
          return (
            <Pressable
              key={key}
              style={[
                styles.statItem,
                { backgroundColor: theme.colors.surface },
                isSelected && { borderWidth: 2, borderColor: color },
              ]}
              onPress={() => {
                setSelectedFilter(key);
                if (initialFilterPreference === 'none') setLastDeckDetailFilter(key);
              }}
            >
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color, fontSize: theme.fontSize.xxl }]}>{count}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <TouchableOpacity
        style={styles.studyBtn}
        activeOpacity={0.8}
        onPress={() => router.push({ pathname: '/study/session', params: { deckId: id, filter: SESSION_FILTER_MAP[selectedFilter] } })}
      >
        <Ionicons name="play" size={20} color="#FFF" />
        <Text style={[styles.studyBtnText, { fontSize: theme.fontSize.lg }]}>{t('deck.study')}</Text>
      </TouchableOpacity>

      <View style={styles.sectionTitleRow}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
          {t('deck.detail')}
        </Text>
        <Text style={[styles.filterDesc, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}>
          {filterDescMap[selectedFilter]}
        </Text>
      </View>

    </>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <TextInput
        ref={keyboardRef}
        style={styles.hiddenKeyboardInput}
        caretHidden
        keyboardType="ascii-capable"
        showSoftInputOnFocus={false}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        onKeyPress={({ nativeEvent: { key } }) => {
          if (key === ' ') {
            router.push({ pathname: '/study/session', params: { deckId: id, filter: SESSION_FILTER_MAP[selectedFilter] } });
          } else if (key === '1') {
            setSelectedFilter('all');
            if (initialFilterPreference === 'none') setLastDeckDetailFilter('all');
          } else if (key === '2') {
            setSelectedFilter('learned');
            if (initialFilterPreference === 'none') setLastDeckDetailFilter('learned');
          } else if (key === '3') {
            setSelectedFilter('review');
            if (initialFilterPreference === 'none') setLastDeckDetailFilter('review');
          } else if (key === '4') {
            setSelectedFilter('new');
            if (initialFilterPreference === 'none') setLastDeckDetailFilter('new');
          } else if (key.toLowerCase() === 'b') {
            router.back();
          } else if (key.toLowerCase() === 'u') {
            listRef.current?.scrollToOffset({ offset: Math.max(0, scrollOffsetRef.current - SCROLL_STEP), animated: true });
          } else if (key.toLowerCase() === 'd') {
            listRef.current?.scrollToOffset({ offset: scrollOffsetRef.current + SCROLL_STEP, animated: true });
          } else if (key.toLowerCase() === 'n') {
            router.push({ pathname: '/deck/[id]/card/new', params: { id } });
          }
        }}
        onBlur={() => { setTimeout(() => { if (isScreenFocusedRef.current) keyboardRef.current?.focus(); }, 50); }}
      />
      <Stack.Screen
        options={{
          title: deck.name,
          headerBackTitle: '',
        }}
      />

      <View style={[styles.header, { backgroundColor: theme.colors.background }]}>
        {ListHeader}
      </View>

      <View style={{ flex: 1 }}>
      {displayedCards.length === 0 ? (
        <View style={styles.emptyCards}>
          <Ionicons name="card-outline" size={52} color={theme.colors.iconSubtle} />
          <Text style={[styles.emptyCardsText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}>
            {selectedFilter === 'all' ? t('deck.noCards') : t('deck.noCardsInFilter')}
          </Text>
        </View>
      ) : (
        <DraggableFlatList
          ref={listRef}
          data={displayedCards}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.container}
          onScrollOffsetChange={(offset) => { scrollOffsetRef.current = offset; }}
          onDragEnd={({ data }) => {
            if (selectedFilter !== 'all') return;
            reorderCards(data);
            updateCardSortOrders(db, data.map((c) => c.id));
          }}
          renderItem={({ item, drag }: RenderItemParams<Card>) => {
          const preview = getPreviewText(item.frontContent);
          return (
            <ScaleDecorator>
              <Pressable
                style={[styles.cardItem, { backgroundColor: theme.colors.surface }]}
                onPress={() =>
                  router.push({
                    pathname: '/deck/[id]/card/[cardId]/edit',
                    params: { id, cardId: item.id },
                  })
                }
                onLongPress={() => {
                  if (selectedFilter !== 'all') {
                    Alert.alert(
                      t('card.reorderDisabledTitle'),
                      t('card.reorderDisabledMessage')
                    );
                    return;
                  }
                  drag();
                }}
              >
                <Text style={[styles.cardPreview, { color: theme.colors.text, fontSize: theme.fontSize.md }]} numberOfLines={2}>
                  {preview || t('card.noText')}
                </Text>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/deck/[id]/card/[cardId]/edit',
                      params: { id, cardId: item.id },
                    })
                  }
                  hitSlop={8}
                >
                  <Ionicons name="pencil-outline" size={18} color={theme.colors.primary} />
                </Pressable>
                <Pressable onPress={() => confirmDeleteCard(item)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={theme.colors.iconSubtle} />
                </Pressable>
              </Pressable>
            </ScaleDecorator>
          );
        }}
        />
      )}
      </View>

      {/* FAB: 戻る */}
      <Pressable style={styles.fabBack} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={28} color="#FFF" />
      </Pressable>

      {/* FAB: 新規カード作成 */}
      <Pressable
        style={styles.fab}
        onPress={() => router.push({ pathname: '/deck/[id]/card/new', params: { id } })}
      >
        <Ionicons name="add" size={28} color="#FFF" />
      </Pressable>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  hiddenKeyboardInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  container: { paddingBottom: 96 },
  header: { padding: 20, gap: 16 },
  description: { lineHeight: 22 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statItem: {
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
  statValue: { fontWeight: '700' },
  statLabel: { marginTop: 2, textAlign: 'center' },
  studyBtn: {
    flexDirection: 'row',
    backgroundColor: '#1976D2',
    borderRadius: 12,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  studyBtnText: { fontWeight: '700', color: '#FFF' },
  sectionTitle: { fontWeight: '700' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 16 },
  filterDesc: { flexShrink: 1 },
  emptyCards: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  emptyCardsText: {},
  cardItem: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 20,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardPreview: { flex: 1, lineHeight: 22 },
  fabBack: {
    position: 'absolute',
    left: 20,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1976D2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1976D2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
});
