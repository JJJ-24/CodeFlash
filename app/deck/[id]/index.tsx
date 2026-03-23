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
  TouchableOpacity,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useTheme } from '@/lib/theme';
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
import type { Block, Card } from '@/types';

type FilterKey = 'all' | 'today' | 'due' | 'unlearned';

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
  const { initialFilterPreference } = useSettingsStore();
  const [todayReviewed, setTodayReviewed] = useState(0);
  const [dueCount, setDueCount] = useState(0);
  const [todayCreatedCount, setTodayCreatedCount] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>(() => {
    const filterMap: Record<string, FilterKey> = {
      all: 'all', learned: 'today', review: 'due', new: 'unlearned', none: 'all',
    };
    return filterMap[initialFilterPreference] ?? 'due';
  });
  const [filterCardIds, setFilterCardIds] = useState<Record<FilterKey, Set<string>>>({
    all: new Set(),
    today: new Set(),
    due: new Set(),
    unlearned: new Set(),
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
      today: new Set(todayIds),
      due: new Set(dueIds),
      unlearned: new Set(todayCreatedIds),
    });
  }, [db, id, setCards]);

  useFocusEffect(
    useCallback(() => {
      if (!deck) {
        router.back();
        return;
      }
      loadCards();
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
    { key: 'today', count: todayReviewed, color: '#4CAF50', label: t('stats.learned') },
    { key: 'due', count: dueCount, color: '#F57C00', label: t('stats.statDue') },
    { key: 'unlearned', count: todayCreatedCount, color: theme.colors.textSecondary, label: t('stats.newToday') },
  ];

  const ListHeader = (
    <View style={styles.header}>
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
              onPress={() => setSelectedFilter(key)}
            >
              <Text style={[styles.statValue, { color, fontSize: theme.fontSize.xxl }]}>{count}</Text>
              <Text style={[styles.statLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <TouchableOpacity
        style={styles.studyBtn}
        activeOpacity={0.8}
        onPress={() => router.push({ pathname: '/study/session', params: { deckId: id, filter: selectedFilter } })}
      >
        <Ionicons name="play" size={20} color="#FFF" />
        <Text style={[styles.studyBtnText, { fontSize: theme.fontSize.lg }]}>{t('deck.study')}</Text>
      </TouchableOpacity>

      <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
        {t('deck.detail')}
      </Text>

      {displayedCards.length === 0 ? (
        <View style={styles.emptyCards}>
          <Ionicons name="card-outline" size={52} color={theme.colors.iconSubtle} />
          <Text style={[styles.emptyCardsText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}>
            {selectedFilter === 'all' ? t('deck.noCards') : t('deck.noCardsInFilter')}
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack.Screen
        options={{
          title: deck.name,
        }}
      />

      <DraggableFlatList
        data={displayedCards}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.container}
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
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
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
