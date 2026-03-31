import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useTheme, FILTER_COLORS } from '@/lib/theme';
import {
  deleteCard,
  getCardsByDeckId,
  getTodayCreatedCardIdsByDeckId,
  getTodayCreatedCountByDeck,
  moveCardsToDeck,
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
import type { Block, Card, Deck } from '@/types';

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
  const { cards, setCards, removeCard, reorderCards, updateCard } = useCardStore();
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [focusedCardIndex, setFocusedCardIndex] = useState<number | null>(null);
  const DECK_SHORTCUTS_NORMAL = [
    { key: 'Space', descKey: 'settings.shortcutStartStudy' },
    { key: '1–4',  descKey: 'settings.shortcutFilterSwitch' },
    { key: 'N',    descKey: 'settings.shortcutNewCard' },
    { key: 'S',    descKey: 'settings.shortcutToggleSelect' },
    { key: 'U',    descKey: 'settings.shortcutScrollUp' },
    { key: 'D',    descKey: 'settings.shortcutScrollDown' },
    { key: 'B',    descKey: 'settings.shortcutBack' },
  ];
  const DECK_SHORTCUTS_SELECT = [
    { key: 'T',     descKey: 'settings.shortcutFocusCard' },
    { key: 'Space', descKey: 'settings.shortcutToggleCheck' },
    { key: 'A',     descKey: 'settings.shortcutSelectAll' },
    { key: 'M',     descKey: 'settings.shortcutMoveSelected' },
    { key: 'D',     descKey: 'settings.shortcutDeleteSelected' },
    { key: 'S / C', descKey: 'settings.shortcutToggleSelect' },
  ];
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

  function handleDeleteSelected() {
    Alert.alert(
      t('card.delete'),
      t('card.deleteSelectedConfirm', { count: selectedCardIds.size }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const ids = Array.from(selectedCardIds);
            for (const cardId of ids) {
              await deleteCard(db, cardId, id as string);
              removeCard(cardId);
            }
            if (deck) {
              updateDeck({ ...deck, cardCount: Math.max(deck.cardCount - ids.length, 0) });
            }
            setSelectionMode(false);
            setSelectedCardIds(new Set());
            setFocusedCardIndex(null);
            await loadCards();
          },
        },
      ]
    );
  }

  function handleMoveToDeck(targetDeck: Deck) {
    setShowDeckPicker(false);
    Alert.alert(
      t('card.moveConfirmTitle'),
      t('card.moveConfirmMessage', { count: selectedCardIds.size, deckName: targetDeck.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.ok'),
          onPress: async () => {
            const ids = Array.from(selectedCardIds);
            await moveCardsToDeck(db, ids, id as string, targetDeck.id);
            ids.forEach((cardId) => {
              const card = cards.find((c) => c.id === cardId);
              if (card) updateCard({ ...card, deckId: targetDeck.id });
            });
            if (deck) {
              updateDeck({ ...deck, cardCount: Math.max(deck.cardCount - ids.length, 0) });
            }
            const tgt = decks.find((d) => d.id === targetDeck.id);
            if (tgt) updateDeck({ ...tgt, cardCount: tgt.cardCount + ids.length });
            setSelectionMode(false);
            setSelectedCardIds(new Set());
            setFocusedCardIndex(null);
            await loadCards();
          },
        },
      ]
    );
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
          if (selectionMode) {
            if (key.toLowerCase() === 't') {
              const next = focusedCardIndex === null ? 0 : (focusedCardIndex + 1) % displayedCards.length;
              setFocusedCardIndex(next);
              listRef.current?.scrollToIndex({ index: next, animated: true, viewPosition: 0.5 });
            } else if (key === ' ') {
              if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
                const cardId = displayedCards[focusedCardIndex].id;
                setSelectedCardIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
                  return next;
                });
              }
            } else if (key.toLowerCase() === 'a') {
              if (selectedCardIds.size === displayedCards.length) {
                setSelectedCardIds(new Set());
              } else {
                setSelectedCardIds(new Set(displayedCards.map((c) => c.id)));
              }
            } else if (key.toLowerCase() === 'm') {
              if (selectedCardIds.size > 0) setShowDeckPicker(true);
            } else if (key.toLowerCase() === 'd') {
              if (selectedCardIds.size > 0) handleDeleteSelected();
            } else if (key.toLowerCase() === 's' || key.toLowerCase() === 'c') {
              setSelectionMode(false);
              setSelectedCardIds(new Set());
              setFocusedCardIndex(null);
              setShowDeckPicker(false);
            }
            return;
          }
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
          } else if (key.toLowerCase() === 's') {
            setSelectionMode((v) => !v);
            setSelectedCardIds(new Set());
            setFocusedCardIndex(null);
            setShowDeckPicker(false);
          }
        }}
        onBlur={() => { setTimeout(() => { if (isScreenFocusedRef.current) keyboardRef.current?.focus(); }, 50); }}
      />
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable
              onPress={() => setShowShortcutsModal(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text }} numberOfLines={1}>
                {deck.name}
              </Text>
              <MaterialIcons name="keyboard" size={18} color={theme.colors.textSecondary} />
            </Pressable>
          ),
          headerBackTitle: '',
          headerRight: () => (
            <Pressable
              onPress={() => {
                setSelectionMode((v) => !v);
                setSelectedCardIds(new Set());
                setFocusedCardIndex(null);
                setShowDeckPicker(false);
              }}
              style={{ paddingHorizontal: 4 }}
            >
              <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.lg, fontWeight: '600' }}>
                {selectionMode ? t('card.cancelSelect') : t('card.select')}
              </Text>
            </Pressable>
          ),
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
          contentContainerStyle={[styles.container, selectionMode && { paddingBottom: 160 }]}
          onScrollOffsetChange={(offset) => { scrollOffsetRef.current = offset; }}
          onScrollToIndexFailed={() => {}}
          onDragEnd={({ data }) => {
            if (selectionMode) return;
            if (selectedFilter !== 'all') return;
            reorderCards(data);
            updateCardSortOrders(db, data.map((c) => c.id));
          }}
          renderItem={({ item, drag, getIndex }: RenderItemParams<Card>) => {
          const preview = getPreviewText(item.frontContent);
          const isSelected = selectedCardIds.has(item.id);
          const isFocused = selectionMode && focusedCardIndex !== null && getIndex() === focusedCardIndex;
          function toggleSelect() {
            setSelectedCardIds((prev) => {
              const next = new Set(prev);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              return next;
            });
          }
          return (
            <ScaleDecorator>
              <Pressable
                style={[
                  styles.cardItem,
                  { backgroundColor: theme.colors.surface },
                  selectionMode && isSelected && { borderWidth: 2, borderColor: theme.colors.primary },
                  selectionMode && isFocused && !isSelected && { borderWidth: 2, borderColor: '#F57C00' },
                ]}
                onPress={() => {
                  if (selectionMode) {
                    toggleSelect();
                  } else {
                    router.push({
                      pathname: '/deck/[id]/card/[cardId]/edit',
                      params: { id, cardId: item.id },
                    });
                  }
                }}
                onLongPress={() => {
                  if (selectionMode) return;
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
                {selectionMode && (
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={isSelected ? theme.colors.primary : theme.colors.iconSubtle}
                  />
                )}
                <Text style={[styles.cardPreview, { color: theme.colors.text, fontSize: theme.fontSize.md }]} numberOfLines={2}>
                  {preview || t('card.noText')}
                </Text>
                {!selectionMode && (
                  <>
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
                  </>
                )}
              </Pressable>
            </ScaleDecorator>
          );
        }}
        />
      )}
      </View>

      {selectionMode ? (
        <View style={[styles.selectionBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.md, fontWeight: '600' }}>
            {t('card.selectedCount', { count: selectedCardIds.size })}
          </Text>
          <View style={styles.selectionActions}>
            <Pressable
              style={[styles.moveBtn, { backgroundColor: '#C62828' }, selectedCardIds.size === 0 && { opacity: 0.4 }]}
              onPress={handleDeleteSelected}
              disabled={selectedCardIds.size === 0}
            >
              <Ionicons name="trash-outline" size={18} color="#FFF" />
              <Text style={{ color: '#FFF', fontWeight: '600', fontSize: theme.fontSize.md }}>
                {t('card.deleteSelected')}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.moveBtn, { backgroundColor: theme.colors.primary }, selectedCardIds.size === 0 && { opacity: 0.4 }]}
              onPress={() => setShowDeckPicker(true)}
              disabled={selectedCardIds.size === 0}
            >
              <Ionicons name="arrow-forward-circle-outline" size={18} color="#FFF" />
              <Text style={{ color: '#FFF', fontWeight: '600', fontSize: theme.fontSize.md }}>
                {t('card.moveToDeck')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
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
        </>
      )}

      <Modal
        visible={showDeckPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDeckPicker(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowDeckPicker(false)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>
              {t('card.selectDeckTitle')}
            </Text>
            {decks.filter((d) => d.id !== id).length === 0 ? (
              <Text style={{ color: theme.colors.textSecondary, padding: 20, fontSize: theme.fontSize.md }}>
                {t('card.noDeckToMove')}
              </Text>
            ) : (
              <FlatList
                data={decks.filter((d) => d.id !== id)}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.deckPickerItem, { borderBottomColor: theme.colors.border }]}
                    onPress={() => handleMoveToDeck(item)}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: '500', fontSize: theme.fontSize.md }}>
                      {item.name}
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                      {item.cardCount}枚
                    </Text>
                  </Pressable>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={showShortcutsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowShortcutsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowShortcutsModal(false)} />
          <View style={[styles.shortcutsSheet, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>
              {t('settings.keyboardShortcuts')}
            </Text>
            <ScrollView>
              <Text style={[styles.shortcutSection, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>
                {t('settings.shortcutNormalMode')}
              </Text>
              {DECK_SHORTCUTS_NORMAL.map(({ key, descKey }) => (
                <View key={key} style={[styles.shortcutRow, { borderBottomColor: theme.colors.border }]}>
                  <View style={[styles.keyBadge, { backgroundColor: theme.colors.background }]}>
                    <Text style={{ fontFamily: 'monospace', fontSize: theme.fontSize.sm, color: theme.colors.text }}>{key}</Text>
                  </View>
                  <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}>{t(descKey)}</Text>
                </View>
              ))}
              <Text style={[styles.shortcutSection, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: 8 }]}>
                {t('settings.shortcutSelectMode')}
              </Text>
              {DECK_SHORTCUTS_SELECT.map(({ key, descKey }) => (
                <View key={key} style={[styles.shortcutRow, { borderBottomColor: theme.colors.border }]}>
                  <View style={[styles.keyBadge, { backgroundColor: theme.colors.background }]}>
                    <Text style={{ fontFamily: 'monospace', fontSize: theme.fontSize.sm, color: theme.colors.text }}>{key}</Text>
                  </View>
                  <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}>{t(descKey)}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  selectionActions: {
    flexDirection: 'row',
    gap: 8,
  },
  moveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 36,
    maxHeight: '60%',
  },
  modalTitle: {
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  deckPickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  shortcutsSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 36,
    maxHeight: '75%',
  },
  shortcutSection: {
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  shortcutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  keyBadge: {
    minWidth: 48,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
  },
});
