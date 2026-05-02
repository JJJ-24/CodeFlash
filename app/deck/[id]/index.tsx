import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useTheme, FILTER_COLORS, MAX_FONT_MULTIPLIER, SHADOW, fontSizeForDigits } from '@/lib/theme';
import { HiddenKeyboardInput } from '@/components/HiddenKeyboardInput';
import {
  deleteCard,
  deleteCardsBulk,
  duplicateCard,
  getCardsByDeckId,
  getUnlearnedCardIdsByDeckId,
  getUnlearnedCountByDeck,
  moveCardsToDeck,
  updateCardSortOrders,
} from '@/lib/database/cards';
import {
  getDueCardIdsByDeckId,
  getDueCountByDeck,
  getTodayReviewedCardIdsByDeckId,
  getTodayReviewedCountByDeck,
} from '@/lib/database/reviews';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { InfoModal } from '@/components/InfoModal';
import { DeckPickerModal } from '@/components/DeckPickerModal';
import { EmptyState } from '@/components/EmptyState';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';
import { useSettingsStore, SESSION_FILTER_MAP, preferenceToFilter } from '@/store/settings';
import type { CardSortOrder, DeckDetailFilter } from '@/store/settings';
import { getCardPreview } from '@/lib/cardPreview';
import type { Card, Deck } from '@/types';

type FilterKey = DeckDetailFilter;

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const initialTopInsetRef = useRef(insets.top);
  const { decks, updateDeck } = useDeckStore();
  const { cards, setCards, removeCard, reorderCards } = useCardStore();
  const { initialFilterPreference, lastDeckDetailFilter, setLastDeckDetailFilter, keyboardShortcutsEnabled, cardSortOrder, setCardSortOrder } = useSettingsStore();
  const [todayReviewed, setTodayReviewed] = useState(0);
  const [dueCount, setDueCount] = useState(0);
  const [unlearnedCount, setUnlearnedCount] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>(
    () => preferenceToFilter(initialFilterPreference) ?? lastDeckDetailFilter,
  );
  const lastFocusTimeRef = useRef(0);
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();
  const listRef = useRef<FlatList<Card>>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [infoModal, setInfoModal] = useState<{ title?: string; message: string } | null>(null);
  const [pendingMoveDeck, setPendingMoveDeck] = useState<Deck | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteModalMessage, setDeleteModalMessage] = useState('');
  const pendingDeleteActionRef = useRef<(() => Promise<void>) | null>(null);
  const focusedCardIdRef = useRef<string | null>(null);
  const [focusedCardId, setFocusedCardIdState] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descTruncatable, setDescTruncatable] = useState(false);
  const DECK_SHORTCUTS_NORMAL = [
    { key: 'Space',     descKey: 'shortcut.startStudy' },
    { key: '1–4',       descKey: 'shortcut.switchFilter' },
    { key: 'J / K',     descKey: 'shortcut.focusNextPrev' },
    { key: 'P',         descKey: 'shortcut.editFocusedItem' },
    { key: 'D',         descKey: 'shortcut.deleteFocused' },
    { key: 'N',         descKey: 'shortcut.new' },
    { key: 'M',         descKey: 'shortcut.cycleCardSort' },
    { key: 'S',         descKey: 'shortcut.toggleSelect' },
    { key: 'B',         descKey: 'shortcut.back' },
  ];
  const DECK_SHORTCUTS_SELECT = [
    { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
    { key: 'Space', descKey: 'shortcut.toggleCheck' },
    { key: 'A',     descKey: 'shortcut.selectAll' },
    { key: 'M',     descKey: 'shortcut.moveSelected' },
    { key: 'D',     descKey: 'shortcut.deleteSelected' },
    { key: 'C',     descKey: 'shortcut.duplicateSelected' },
    { key: 'S',     descKey: 'shortcut.exitSelect' },
  ];
  const [filterCardIds, setFilterCardIds] = useState<Record<FilterKey, Set<string>>>({
    all: new Set(),
    learned: new Set(),
    review: new Set(),
    new: new Set(),
  });

  const deck = decks.find((d) => d.id === id) ?? null;

  const loadCards = useCallback(async () => {
    const [loaded, reviewed, due, unlearned, todayIds, dueIds, unlearnedIds] = await Promise.all([
      getCardsByDeckId(db, id),
      getTodayReviewedCountByDeck(db, id),
      getDueCountByDeck(db, id),
      getUnlearnedCountByDeck(db, id),
      getTodayReviewedCardIdsByDeckId(db, id),
      getDueCardIdsByDeckId(db, id),
      getUnlearnedCardIdsByDeckId(db, id),
    ]);
    setCards(loaded);
    setTodayReviewed(reviewed);
    setDueCount(due);
    setUnlearnedCount(unlearned);
    setFilterCardIds({
      all: new Set(loaded.map((c) => c.id)),
      learned: new Set(todayIds),
      review: new Set(dueIds),
      new: new Set(unlearnedIds),
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
    const preview = getCardPreview(card.frontContent, t('card.imageBlock')).replace(/\n/g, ' ');
    const name = (preview || t('card.noText')).slice(0, 20) + ((preview || t('card.noText')).length > 20 ? '…' : '');
    pendingDeleteActionRef.current = async () => {
      await deleteCard(db, card.id, id);
      removeCard(card.id);
      setFocusedCardIndex(null);
      if (deck) updateDeck({ ...deck, cardCount: Math.max(deck.cardCount - 1, 0) });
      await loadCards();
    };
    setDeleteModalMessage(t('card.deleteConfirm', { name }));
    setShowDeleteModal(true);
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
    pendingDeleteActionRef.current = async () => {
      setIsProcessing(true);
      try {
        const ids = Array.from(selectedCardIds);
        await deleteCardsBulk(db, ids, id as string);
        if (deck) updateDeck({ ...deck, cardCount: Math.max(deck.cardCount - ids.length, 0) });
        exitSelectionMode();
        await loadCards();
      } finally {
        setIsProcessing(false);
      }
    };
    setDeleteModalMessage(t('card.deleteSelectedConfirm', { count: selectedCardIds.size }));
    setShowDeleteModal(true);
  }

  async function handleDeleteConfirm() {
    setShowDeleteModal(false);
    await pendingDeleteActionRef.current?.();
    pendingDeleteActionRef.current = null;
  }

  async function handleDuplicate() {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const ids = Array.from(selectedCardIds);
      for (const cardId of ids) {
        await duplicateCard(db, cardId);
      }
      if (deck) {
        updateDeck({ ...deck, cardCount: deck.cardCount + ids.length });
      }
      exitSelectionMode();
      await loadCards();
      setInfoModal({ title: t('card.duplicate'), message: t('card.duplicateSuccess', { count: ids.length }) });
    } finally {
      setIsProcessing(false);
    }
  }

  function handleMoveToDeck(targetDeck: Deck) {
    setShowDeckPicker(false);
    setPendingMoveDeck(targetDeck);
  }

  async function doMove() {
    if (!pendingMoveDeck) return;
    const targetDeck = pendingMoveDeck;
    setPendingMoveDeck(null);
    setIsProcessing(true);
    try {
      const ids = Array.from(selectedCardIds);
      await moveCardsToDeck(db, ids, id as string, targetDeck.id);
      if (deck) {
        updateDeck({ ...deck, cardCount: Math.max(deck.cardCount - ids.length, 0) });
      }
      const tgt = decks.find((d) => d.id === targetDeck.id);
      if (tgt) updateDeck({ ...tgt, cardCount: tgt.cardCount + ids.length });
      exitSelectionMode();
      await loadCards();
    } finally {
      setIsProcessing(false);
    }
  }

  if (!deck) return null;

  const deckCards = cards.filter((c) => c.deckId === id);
  const filteredCards = selectedFilter === 'all'
    ? deckCards
    : deckCards.filter((c) => filterCardIds[selectedFilter].has(c.id));
  const displayedCards = cardSortOrder === 'newest'
    ? [...filteredCards].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : cardSortOrder === 'oldest'
    ? [...filteredCards].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : filteredCards;

  const FILTER_KEY_MAP: Record<string, FilterKey> = { '1': 'all', '2': 'learned', '3': 'review', '4': 'new' };

  const focusedCardIndex = focusedCardId != null
    ? (() => { const i = displayedCards.findIndex(c => c.id === focusedCardId); return i === -1 ? null : i; })()
    : null;
  function setFocusedCardIndex(idx: number | null) {
    const id = idx != null && displayedCards[idx] ? displayedCards[idx].id : null;
    focusedCardIdRef.current = id;
    setFocusedCardIdState(id);
  }

  function moveFocus(direction: 'next' | 'prev') {
    if (displayedCards.length === 0) return;
    const currentId = focusedCardIdRef.current;
    const currentIdx = currentId != null ? displayedCards.findIndex(c => c.id === currentId) : null;
    const ci = currentIdx === -1 ? null : currentIdx;
    const next = direction === 'next'
      ? (ci === null ? 0 : ci === displayedCards.length - 1 ? null : ci + 1)
      : (ci === null ? displayedCards.length - 1 : ci === 0 ? null : ci - 1);
    const newId = next != null && displayedCards[next] ? displayedCards[next].id : null;
    focusedCardIdRef.current = newId;
    setFocusedCardIdState(newId);
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
    { key: 'all', count: deck.cardCount, color: theme.colors.primary, label: t('common.all') },
    { key: 'learned', count: todayReviewed, color: FILTER_COLORS.learned, label: t('common.learned') },
    { key: 'review', count: dueCount, color: FILTER_COLORS.due, label: t('common.due') },
    { key: 'new', count: unlearnedCount, color: theme.colors.textSecondary, label: t('common.new') },
  ];

  const filterItemMaxDigits = Math.max(...filterItems.map(f => String(f.count).length));
  const filterValueFontSize = fontSizeForDigits(theme, (Platform as any).isPad ? 1 : filterItemMaxDigits);

  const cardSortDesc = cardSortOrder === 'newest' ? t('card.sortDescNewest')
    : cardSortOrder === 'oldest' ? t('card.sortDescOldest')
    : t('home.sortDescManual');
  const filterDescMap: Record<FilterKey, string> = {
    all: cardSortDesc,
    learned: t('study.filterDescLearned'),
    review: t('study.filterDescReview'),
    new: t('study.filterDescNew'),
  };

  const CARD_SORT_OPTIONS: { key: CardSortOrder; icon: 'reorder-three-outline' | 'arrow-down-outline' | 'arrow-up-outline' }[] = [
    { key: 'manual',  icon: 'reorder-three-outline' },
    { key: 'newest',  icon: 'arrow-down-outline' },
    { key: 'oldest',  icon: 'arrow-up-outline' },
  ];

  const ListHeader = deck.description ? (
    <View style={[styles.descBlock, { backgroundColor: theme.colors.background }]}>
      {/* 行数計測用の非表示 Text */}
      <Text
        style={[styles.description, { color: 'transparent', fontSize: theme.fontSize.md, position: 'absolute', opacity: 0 }]}
        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
        onTextLayout={(e) => setDescTruncatable(e.nativeEvent.lines.length > 2)}
      >
        {deck.description}
      </Text>
      <Text
        style={[styles.description, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}
        numberOfLines={descExpanded ? undefined : 2}
        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
      >
        {deck.description}
      </Text>
      {descTruncatable && (
        <Pressable onPress={() => setDescExpanded((v) => !v)} style={styles.descToggleBtn}>
          <Text style={[styles.descToggleText, { color: theme.colors.primary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {descExpanded ? t('common.showLess') : t('common.showMore')}
          </Text>
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <HiddenKeyboardInput
        ref={keyboardRef}
        onKeyPress={({ nativeEvent: { key } }) => {
          if (!keyboardShortcutsEnabled) return;
          const k = key.toLowerCase();
          if (selectionMode) {
            if (k === 'j') { moveFocus('next'); }
            else if (k === 'k') { moveFocus('prev'); }
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
            else if (k === 'm') { if (selectedCardIds.size > 0 && !isProcessing) setShowDeckPicker(true); }
            else if (k === 'd') { if (selectedCardIds.size > 0 && !isProcessing) handleDeleteSelected(); }
            else if (k === 'c') { if (selectedCardIds.size > 0 && !isProcessing) handleDuplicate(); }
            else if (k === 's') { exitSelectionMode(); }
            return;
          }
          if (key === ' ') {
            if (displayedCards.length === 0) return;
            router.push({ pathname: '/study/session', params: { deckId: id, filter: SESSION_FILTER_MAP[selectedFilter] } });
          } else if (FILTER_KEY_MAP[key]) {
            const f = FILTER_KEY_MAP[key];
            setSelectedFilter(f);
            if (initialFilterPreference === 'none') setLastDeckDetailFilter(f);
          } else if (k === 'j') { moveFocus('next'); }
          else if (k === 'k') { moveFocus('prev'); }
          else if (k === 'p') {
            if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
              navigateToCardEdit(displayedCards[focusedCardIndex].id);
            }
          } else if (k === 'b') { router.back(); }
          else if (k === 'd') {
            if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
              confirmDeleteCard(displayedCards[focusedCardIndex]);
            }
          } else if (k === 'n') {
            router.push({ pathname: '/deck/[id]/card/new', params: { id } });
          } else if (k === 'm' && selectedFilter === 'all') {
            const orders: CardSortOrder[] = ['manual', 'newest', 'oldest'];
            setCardSortOrder(orders[(orders.indexOf(cardSortOrder) + 1) % 3]);
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
      <Stack.Screen options={{ headerShown: false }} />

      {/* インラインカスタムヘッダー */}
      <View style={{ height: initialTopInsetRef.current + 44, backgroundColor: theme.colors.surface }}>
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 44,
          flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
        }}>
          <Pressable
            onPress={keyboardShortcutsEnabled && !selectionMode ? () => setShowShortcutsModal(true) : undefined}
            style={{
              position: 'absolute', left: 0, right: 0,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
              paddingHorizontal: 56, gap: 4,
            }}
          >
            <Text
              style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text, maxWidth: screenWidth * 0.46, flexShrink: 1 }}
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {deck?.name ?? ''}
            </Text>
            {keyboardShortcutsEnabled && !selectionMode && (
              <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
            )}
          </Pressable>
          <Pressable
            onPress={() => { if (Date.now() - lastFocusTimeRef.current >= 350) router.back(); }}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={4}
          >
            <Ionicons name="chevron-back" size={28} color={theme.colors.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
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
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={4}
          >
            <Ionicons
              name={selectionMode ? 'close' : 'albums-outline'}
              size={26}
              color={theme.colors.primary}
            />
          </Pressable>
        </View>
      </View>

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
                  isSelected && { margin: 0, borderWidth: 2, borderColor: color },
                  selectionMode && { opacity: 0.5 },
                ]}
                onPress={() => {
                  if (selectionMode) return;
                  setSelectedFilter(key);
                  if (initialFilterPreference === 'none') setLastDeckDetailFilter(key);
                }}
              >
                <Text numberOfLines={1} allowFontScaling={false} style={[styles.statValue, { color, fontSize: filterValueFontSize }]}>{count}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.studyBtn, { backgroundColor: theme.colors.primary }, (selectionMode || displayedCards.length === 0) && { opacity: 0.5 }]}
          activeOpacity={0.8}
          disabled={selectionMode || displayedCards.length === 0}
          onPress={() => { router.push({ pathname: '/study/session', params: { deckId: id, filter: SESSION_FILTER_MAP[selectedFilter] } }); }}
        >
          <Ionicons name="play" size={20} color="#FFF" />
          <Text style={[styles.studyBtnText, { fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('deck.study')}</Text>
        </TouchableOpacity>

        <View style={styles.sectionTitleRow}>
          <View style={styles.sectionTitleLeft}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {selectionMode ? t('card.selectHint') : t('card.list')}
            </Text>
            <Text style={[styles.filterDesc, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {filterDescMap[selectedFilter]}
            </Text>
          </View>
          {selectedFilter === 'all' && !selectionMode && (
            <View style={styles.sortButtons}>
              {CARD_SORT_OPTIONS.map(({ key, icon }) => {
                const active = cardSortOrder === key;
                return (
                  <Pressable
                    key={key}
                    style={[
                      styles.sortBtn,
                      { borderColor: active ? theme.colors.primary : theme.colors.buttonBorder, paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
                      active && { backgroundColor: theme.colors.primary },
                    ]}
                    onPress={() => setCardSortOrder(key)}
                  >
                    <Ionicons name={icon} size={theme.fontSize.lg} color={active ? '#FFF' : theme.colors.textSecondary} />
                  </Pressable>
                );
              })}
            </View>
          )}
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
          onScrollToIndexFailed={() => {}}
          onDragEnd={({ data }) => {
            if (selectionMode) return;
            if (selectedFilter !== 'all' || cardSortOrder !== 'manual') return;
            reorderCards(data);
            updateCardSortOrders(db, data.map((c) => c.id));
          }}
          renderItem={({ item, drag, getIndex }: RenderItemParams<Card>) => {
          const preview = getCardPreview(item.frontContent, t('card.imageBlock'));
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
                    setInfoModal({ title: t('card.reorderDisabledTitle'), message: t('card.reorderDisabledMessage') });
                    return;
                  }
                  if (cardSortOrder !== 'manual') {
                    setInfoModal({ title: t('card.reorderDisabledTitle'), message: t('card.reorderDisabledMessageSort') });
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
                <Text style={[styles.cardPreview, { color: theme.colors.text, fontSize: theme.fontSize.md }]} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  {preview || t('card.noText')}
                </Text>
                {!selectionMode && (
                  <View style={styles.cardActions}>
                    <Pressable onPress={() => navigateToCardEdit(item.id)} hitSlop={8} style={{ padding: 4 }}>
                      <Ionicons name="pencil-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
                    </Pressable>
                  </View>
                )}
              </Pressable>
            </ScaleDecorator>
          );
        }}
        />
      </Pressable>

      {selectionMode ? (
        <View style={[styles.selectionBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
          <Pressable onPress={toggleSelectAll} style={[styles.iconBtn, { backgroundColor: theme.colors.primary }]} accessibilityLabel={t('card.selectAll')}>
            <Ionicons
              name={selectedCardIds.size === displayedCards.length ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={22}
              color="#FFF"
            />
          </Pressable>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('card.selectedCount', { count: selectedCardIds.size })}
          </Text>
          <View style={styles.selectionActions}>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: theme.colors.primary }, selectedCardIds.size === 0 && { opacity: 0.4 }]}
              onPress={handleDuplicate}
              disabled={selectedCardIds.size === 0 || isProcessing}
              accessibilityLabel={t('card.duplicate')}
            >
              <Ionicons name={isProcessing ? 'hourglass-outline' : 'copy-outline'} size={22} color="#FFF" />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: '#C62828' }, (selectedCardIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={handleDeleteSelected}
              disabled={selectedCardIds.size === 0 || isProcessing}
            >
              <Ionicons name="trash-outline" size={22} color="#FFF" />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: theme.colors.primary }, (selectedCardIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={() => { if (!isProcessing) setShowDeckPicker(true); }}
              disabled={selectedCardIds.size === 0 || isProcessing}
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
          { title: t('shortcut.normalMode'), items: DECK_SHORTCUTS_NORMAL },
          { title: t('shortcut.selectMode'), items: DECK_SHORTCUTS_SELECT },
        ]}
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={deleteModalMessage}
        onConfirm={handleDeleteConfirm}
        onClose={() => setShowDeleteModal(false)}
      />
      <InfoModal
        visible={!!infoModal}
        title={infoModal?.title}
        message={infoModal?.message ?? ''}
        onClose={() => setInfoModal(null)}
      />
      <ConfirmModal
        visible={!!pendingMoveDeck}
        title={t('card.moveConfirmTitle')}
        message={t('card.moveConfirmMessage', { count: selectedCardIds.size, deckName: pendingMoveDeck?.name ?? '' })}
        actions={[{ label: t('common.ok'), onPress: doMove }]}
        onClose={() => setPendingMoveDeck(null)}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 96, paddingTop: 20 },
  fixedHeader: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  descBlock: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 12 },
  description: { lineHeight: 22 },
  descToggleBtn: { paddingTop: 4, paddingBottom: 8 },
  descToggleText: { fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 4, marginHorizontal: -2 },
  statItem: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    margin: 2,
    ...SHADOW.card,
  },
  statValue: { fontWeight: '700' },
  statLabel: { marginTop: 2, textAlign: 'center' },
  filterDesc: { marginTop: 2 },
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
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleLeft: { flexDirection: 'column', gap: 2, flex: 1 },
  sortButtons: { flexDirection: 'row', gap: 6 },
  sortBtn: { borderRadius: 6, borderWidth: 1, paddingVertical: 7 },
  cardItem: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...SHADOW.subtle,
  },
  cardPreview: { flex: 1, lineHeight: 22 },
  cardActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
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
