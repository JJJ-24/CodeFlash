import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useTheme, FILTER_COLORS } from '@/lib/theme';
import {
  deleteCard,
  duplicateCard,
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
import { DeckPickerModal } from '@/components/DeckPickerModal';
import { EmptyState } from '@/components/EmptyState';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';
import { useSettingsStore, SESSION_FILTER_MAP, preferenceToFilter } from '@/store/settings';
import type { DeckDetailFilter } from '@/store/settings';
import type { Block, Card, Deck } from '@/types';

type FilterKey = DeckDetailFilter;

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
  const { width: screenWidth } = useWindowDimensions();
  const { decks, updateDeck } = useDeckStore();
  const { cards, setCards, removeCard, reorderCards, updateCard } = useCardStore();
  const { initialFilterPreference, lastDeckDetailFilter, setLastDeckDetailFilter, keyboardShortcutsEnabled } = useSettingsStore();
  const [todayReviewed, setTodayReviewed] = useState(0);
  const [dueCount, setDueCount] = useState(0);
  const [todayCreatedCount, setTodayCreatedCount] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>(
    () => preferenceToFilter(initialFilterPreference) ?? lastDeckDetailFilter,
  );
  const lastFocusTimeRef = useRef(0);
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();
  const listRef = useRef<FlatList<Card>>(null);
  const scrollOffsetRef = useRef(0);
  const SCROLL_STEP = 200;
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [focusedCardIndex, setFocusedCardIndex] = useState<number | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descTruncatable, setDescTruncatable] = useState(false);
  const DECK_SHORTCUTS_NORMAL = [
    { key: 'Space',     descKey: 'settings.shortcutStartStudy' },
    { key: '1–4',       descKey: 'settings.shortcutFilterSwitch' },
    { key: 'T / Y',     descKey: 'settings.shortcutFocusCardNextPrev' },
    { key: 'Return / P', descKey: 'settings.shortcutEditCard' },
    { key: 'N',         descKey: 'settings.shortcutNewCard' },
    { key: 'S',         descKey: 'settings.shortcutToggleSelect' },
    { key: 'U / D',     descKey: 'settings.shortcutScrollUpDownDelete' },
    { key: 'B',         descKey: 'settings.shortcutBack' },
  ];
  const DECK_SHORTCUTS_SELECT = [
    { key: 'T / Y',   descKey: 'settings.shortcutFocusCardNextPrev' },
    { key: 'Space', descKey: 'settings.shortcutToggleCheck' },
    { key: 'A',     descKey: 'settings.shortcutSelectAll' },
    { key: 'M',     descKey: 'settings.shortcutMoveSelected' },
    { key: 'D',     descKey: 'settings.shortcutDeleteSelected' },
    { key: 'C',     descKey: 'settings.shortcutDuplicateSelected' },
    { key: 'S',     descKey: 'settings.shortcutExitSelect' },
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
      lastFocusTimeRef.current = Date.now();
      setDescExpanded(false);
      loadCards();
      // 前の画面でソフトキーボードが残留していた場合に確実に閉じる
      Keyboard.dismiss();
      onScreenFocus();
      return () => { onScreenBlur(); };
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
    const preview = getPreviewText(card.frontContent);
    const name = (preview || t('card.noText')).slice(0, 20) + ((preview || t('card.noText')).length > 20 ? '…' : '');
    Alert.alert(t('card.delete'), t('card.deleteConfirm', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteCard(db, card.id, id);
          removeCard(card.id);
          setFocusedCardIndex(null);
          if (deck) {
            updateDeck({ ...deck, cardCount: Math.max(deck.cardCount - 1, 0) });
          }
          loadCards();
        },
      },
    ]);
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedCardIds(new Set());
    setFocusedCardIndex(null);
    setShowDeckPicker(false);
  }

  function navigateToCardEdit(cardId: string) {
    router.push({
      pathname: '/deck/[id]/card/[cardId]/edit',
      params: { id, cardId },
    });
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
            exitSelectionMode();
            await loadCards();
          },
        },
      ]
    );
  }

  async function handleDuplicate() {
    const ids = Array.from(selectedCardIds);
    for (const cardId of ids) {
      await duplicateCard(db, cardId);
    }
    if (deck) {
      updateDeck({ ...deck, cardCount: deck.cardCount + ids.length });
    }
    exitSelectionMode();
    await loadCards();
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
            exitSelectionMode();
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

  const FILTER_KEY_MAP: Record<string, FilterKey> = { '1': 'all', '2': 'learned', '3': 'review', '4': 'new' };

  function moveFocus(direction: 'next' | 'prev') {
    if (displayedCards.length === 0) return;
    const next = direction === 'next'
      ? (focusedCardIndex === null ? 0 : focusedCardIndex === displayedCards.length - 1 ? null : focusedCardIndex + 1)
      : (focusedCardIndex === null ? displayedCards.length - 1 : focusedCardIndex === 0 ? null : focusedCardIndex - 1);
    setFocusedCardIndex(next);
    if (next !== null) listRef.current?.scrollToIndex({ index: next, animated: true, viewPosition: 0.5 });
  }

  function toggleSelectAll() {
    if (selectedCardIds.size === displayedCards.length) {
      setSelectedCardIds(new Set());
    } else {
      setSelectedCardIds(new Set(displayedCards.map((c) => c.id)));
    }
  }

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

  const ListHeader = deck.description ? (
    <View style={[styles.descBlock, { backgroundColor: theme.colors.background }]}>
      {/* 行数計測用の非表示 Text */}
      <Text
        style={[styles.description, { color: 'transparent', fontSize: theme.fontSize.md, position: 'absolute', opacity: 0 }]}
        onTextLayout={(e) => setDescTruncatable(e.nativeEvent.lines.length > 2)}
      >
        {deck.description}
      </Text>
      <Text
        style={[styles.description, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}
        numberOfLines={descExpanded ? undefined : 2}
      >
        {deck.description}
      </Text>
      {descTruncatable && (
        <Pressable onPress={() => setDescExpanded((v) => !v)} style={styles.descToggleBtn}>
          <Text style={[styles.descToggleText, { color: theme.colors.primary, fontSize: theme.fontSize.sm }]}>
            {descExpanded ? t('common.showLess') : t('common.showMore')}
          </Text>
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
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
          const k = key.toLowerCase();
          if (selectionMode) {
            if (k === 't') { moveFocus('next'); }
            else if (k === 'y') { moveFocus('prev'); }
            else if (key === ' ') {
              if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
                const cardId = displayedCards[focusedCardIndex].id;
                setSelectedCardIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
                  return next;
                });
              }
            }
            else if (k === 'a') { toggleSelectAll(); }
            else if (k === 'm') { if (selectedCardIds.size > 0) setShowDeckPicker(true); }
            else if (k === 'd') { if (selectedCardIds.size > 0) handleDeleteSelected(); }
            else if (k === 'c') { if (selectedCardIds.size > 0) handleDuplicate(); }
            else if (k === 's') { exitSelectionMode(); }
            return;
          }
          if (key === ' ') {
            router.push({ pathname: '/study/session', params: { deckId: id, filter: SESSION_FILTER_MAP[selectedFilter] } });
          } else if (FILTER_KEY_MAP[key]) {
            const f = FILTER_KEY_MAP[key];
            setSelectedFilter(f);
            setFocusedCardIndex(null);
            if (initialFilterPreference === 'none') setLastDeckDetailFilter(f);
          } else if (k === 't') { moveFocus('next'); }
          else if (k === 'y') { moveFocus('prev'); }
          else if (k === 'p') {
            if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
              navigateToCardEdit(displayedCards[focusedCardIndex].id);
            }
          } else if (k === 'b') { router.back(); }
          else if (k === 'u') {
            listRef.current?.scrollToOffset({ offset: Math.max(0, scrollOffsetRef.current - SCROLL_STEP), animated: true });
          } else if (k === 'd') {
            if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
              confirmDeleteCard(displayedCards[focusedCardIndex]);
            } else {
              listRef.current?.scrollToOffset({ offset: scrollOffsetRef.current + SCROLL_STEP, animated: true });
            }
          } else if (k === 'n') {
            router.push({ pathname: '/deck/[id]/card/new', params: { id } });
          } else if (k === 's') {
            setSelectionMode((v) => !v);
            setSelectedCardIds(new Set());
            setFocusedCardIndex(null);
          }
        }}
        onSubmitEditing={() => {
          if (!keyboardShortcutsEnabled) return;
          if (!selectionMode && focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
            navigateToCardEdit(displayedCards[focusedCardIndex].id);
          }
        }}
        onBlur={onInputBlur}
      />
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable
              onPress={keyboardShortcutsEnabled && !selectionMode ? () => setShowShortcutsModal(true) : undefined}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: screenWidth * 0.46 }}
            >
              <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text, flexShrink: 1 }} numberOfLines={1}>
                {deck.name}
              </Text>
              {keyboardShortcutsEnabled && !selectionMode && (
                <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
              )}
            </Pressable>
          ),
          headerBackTitle: '',
          headerLeft: () => (
            <Pressable
              onPress={() => { if (Date.now() - lastFocusTimeRef.current >= 350) router.back(); }}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={4}
            >
              <Ionicons name="chevron-back" size={28} color={theme.colors.text} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => {
                if (selectionMode) {
                  exitSelectionMode();
                } else {
                  setSelectionMode(true);
                  setSelectedCardIds(new Set());
                  setFocusedCardIndex(null);
                }
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

      {/* 固定ヘッダー: 統計・学習ボタン・セクションタイトル */}
      <View style={[styles.fixedHeader, { backgroundColor: theme.colors.background }]}>
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
                  selectionMode && { opacity: 0.5 },
                ]}
                onPress={() => {
                  if (selectionMode) return;
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
          style={[styles.studyBtn, { backgroundColor: theme.colors.primary }, selectionMode && { opacity: 0.5 }]}
          activeOpacity={0.8}
          disabled={selectionMode}
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
      </View>

      <Pressable style={{ flex: 1 }} onPress={() => { if (!selectionMode) setFocusedCardIndex(null); }}>
        <DraggableFlatList
          ref={listRef as any}
          data={displayedCards}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={ListHeader}
          ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => { if (!selectionMode) setFocusedCardIndex(null); }} />}
          ListEmptyComponent={
            <EmptyState
              icon="card-outline"
              title={selectedFilter === 'all' ? t('deck.noCards') : t('deck.noCardsInFilter')}
              subtitle={selectedFilter === 'all' ? t('deck.noCardsSub') : undefined}
            />
          }
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
          const isFocused = focusedCardIndex !== null && getIndex() === focusedCardIndex;
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
                  selectionMode && isFocused && { borderWidth: 2, borderColor: '#F57C00' },
                  !selectionMode && isFocused && { borderWidth: 2, borderColor: theme.colors.primary },
                ]}
                onPress={() => {
                  if (selectionMode) {
                    toggleSelect();
                  } else {
                    const idx = getIndex();
                    if (idx !== undefined) setFocusedCardIndex(idx);
                    navigateToCardEdit(item.id);
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
                      onPress={() => navigateToCardEdit(item.id)}
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
      </Pressable>

      {selectionMode ? (
        <View style={[styles.selectionBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
          <Pressable onPress={toggleSelectAll}>
            <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.md, fontWeight: '600' }}>
              {selectedCardIds.size === displayedCards.length ? t('card.cancelSelect') : t('card.selectAll')}
            </Text>
          </Pressable>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.md, fontWeight: '600' }}>
            {t('card.selectedCount', { count: selectedCardIds.size })}
          </Text>
          <View style={styles.selectionActions}>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: theme.colors.primary }, selectedCardIds.size === 0 && { opacity: 0.4 }]}
              onPress={handleDuplicate}
              disabled={selectedCardIds.size === 0}
              accessibilityLabel={t('card.duplicate')}
            >
              <Ionicons name="copy-outline" size={22} color="#FFF" />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: '#C62828' }, selectedCardIds.size === 0 && { opacity: 0.4 }]}
              onPress={handleDeleteSelected}
              disabled={selectedCardIds.size === 0}
            >
              <Ionicons name="trash-outline" size={22} color="#FFF" />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: theme.colors.primary }, selectedCardIds.size === 0 && { opacity: 0.4 }]}
              onPress={() => setShowDeckPicker(true)}
              disabled={selectedCardIds.size === 0}
            >
              <Ionicons name="arrow-forward-circle-outline" size={22} color="#FFF" />
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          {/* FAB: 戻る */}
          <Pressable style={[styles.fab, { left: 20, backgroundColor: theme.colors.primary }]} onPress={() => { if (Date.now() - lastFocusTimeRef.current >= 350) router.back(); }}>
            <Ionicons name="chevron-back" size={28} color="#FFF" />
          </Pressable>

          {/* FAB: 新規カード作成 */}
          <Pressable
            style={[styles.fab, { right: 20, backgroundColor: theme.colors.primary }]}
            onPress={() => router.push({ pathname: '/deck/[id]/card/new', params: { id } })}
          >
            <Ionicons name="add" size={28} color="#FFF" />
          </Pressable>
        </>
      )}

      <DeckPickerModal
        visible={showDeckPicker}
        title={t('card.selectDeckTitle')}
        decks={decks.filter((d) => d.id !== id)}
        onSelect={handleMoveToDeck}
        onClose={() => setShowDeckPicker(false)}
        showCardCount
      />
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        maxHeight="75%"
        sections={[
          { title: t('settings.shortcutNormalMode'), items: DECK_SHORTCUTS_NORMAL },
          { title: t('settings.shortcutSelectMode'), items: DECK_SHORTCUTS_SELECT },
        ]}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  hiddenKeyboardInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  container: { paddingBottom: 96 },
  fixedHeader: { paddingHorizontal: 20, paddingTop: 16, gap: 16 },
  descBlock: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  description: { lineHeight: 22 },
  descToggleBtn: { paddingTop: 4, paddingBottom: 8 },
  descToggleText: { fontWeight: '600' },
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
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
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
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
