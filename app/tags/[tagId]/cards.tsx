import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { DeckPickerModal } from '@/components/DeckPickerModal';
import { InfoModal } from '@/components/InfoModal';
import { InfoContent } from '@/components/InfoContent';
import { SwipeToDeleteRow } from '@/components/SwipeToDeleteRow';
import { CardStatsSheet } from '@/components/stats/CardStatsSheet';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW, fontSizeForDigits } from '@/lib/theme';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useListNavigation } from '@/hooks/useListNavigation';
import { deleteCard, getCardsByTagId, setCardArchived, setCardsArchived } from '@/lib/database/cards';
import { removeTagFromCards } from '@/lib/database/tags';
import { getCardPreview } from '@/lib/cardPreview';
import { useSettingsStore } from '@/store/settings';
import { useProStore } from '@/store/pro';
import { useDeckStore } from '@/store/decks';
import { useTagStore } from '@/store/tags';
import type { Card } from '@/types';

const TAG_CARDS_SHORTCUTS = [
  { key: '1 / 2',   descKey: 'shortcut.switchFilterAllActive' },
  { key: 'J / K',   descKey: 'shortcut.focusNextPrev' },
  { key: 'P',       descKey: 'shortcut.editFocusedItem' },
  { key: 'A',     descKey: 'shortcut.toggleCardStats', pro: true },
  { key: 'D',     descKey: 'shortcut.deleteFocused' },
  { key: 'N',     descKey: 'shortcut.new' },
  { key: 'S',     descKey: 'shortcut.toggleSelect' },
  { key: 'B',     descKey: 'shortcut.back' },
  { key: '↑ / ↓', descKey: 'shortcut.arrows' },
  { key: 'ESC',   descKey: 'shortcut.esc' },
];

const TAG_CARDS_SELECTION_SHORTCUTS = [
  { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
  { key: 'Space', descKey: 'shortcut.toggleCheck' },
  { key: 'A',     descKey: 'shortcut.selectAll' },
  { key: 'T',     descKey: 'shortcut.removeTagSelected' },
  { key: 'E',     descKey: 'shortcut.archiveSelected' },
  { key: 'S',     descKey: 'shortcut.exitSelect' },
  { key: '↑ / ↓', descKey: 'shortcut.arrows' },
  { key: 'ESC',   descKey: 'shortcut.esc' },
];

export default function TagCardsScreen() {
  const { tagId } = useLocalSearchParams<{ tagId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const initialTopInsetRef = useRef(insets.top);
  const lastFocusTimeRef = useRef(0);
  const { decks } = useDeckStore();
  const { tags } = useTagStore();
  const { keyboardShortcutsEnabled, cardSortOrder, lastTagCardFilter, setLastTagCardFilter } = useSettingsStore();
  const { isPro } = useProStore();
  const [statsCardId, setStatsCardId] = useState<string | null>(null);
  const { width: screenWidth } = useWindowDimensions();

  const [cards, setCards] = useState<Card[]>([]);
  const tag = tags.find((t) => t.id === tagId) ?? null;
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showTagCardsInfo, setShowTagCardsInfo] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteModalMessage, setDeleteModalMessage] = useState('');
  const [pendingDeleteCard, setPendingDeleteCard] = useState<Card | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [showRemoveTagModal, setShowRemoveTagModal] = useState(false);

  // 実効アーカイブ（カード自身 or 所属デッキがアーカイブ）。「有効」フィルターで除外する。
  const isEffectivelyArchived = useCallback(
    (c: Card) => c.archived || !!decks.find((d) => d.id === c.deckId)?.archived,
    [decks],
  );
  const activeCardCount = useMemo(() => cards.filter((c) => !isEffectivelyArchived(c)).length, [cards, isEffectivelyArchived]);
  const displayedCards = useMemo(
    () => (lastTagCardFilter === 'active' ? cards.filter((c) => !isEffectivelyArchived(c)) : cards),
    [cards, lastTagCardFilter, isEffectivelyArchived],
  );
  // ホームのフィルターブロックと同じ寸法（4列レイアウトの1ブロック幅）
  const blockWidth = (screenWidth - 56) / 4;
  const filterBlockMinHeight = 32 + Math.ceil(fontSizeForDigits(theme, 1) * 1.35) + 2 + Math.ceil(theme.fontSize.xs * 1.35);

  const { focusedIndex: focusedCardIndex, setFocusedIndex: setFocusedCardIndex, listRef, moveFocus } = useListNavigation(displayedCards, (c) => c.id);

  function confirmDeleteCard(card: Card) {
    const rawPreview = getCardPreview(card.frontContent, t('card.imageBlock')).replace(/\n/g, ' ');
    const preview = rawPreview || t('card.noText');
    const name = preview.length > 20 ? preview.slice(0, 20) + '…' : preview;
    setPendingDeleteCard(card);
    setDeleteModalMessage(t('card.deleteConfirm', { name }));
    setShowDeleteModal(true);
  }

  async function handleDeleteConfirm() {
    if (!pendingDeleteCard) return;
    setShowDeleteModal(false);
    await deleteCard(db, pendingDeleteCard.id, pendingDeleteCard.deckId);
    setCards((prev) => prev.filter((c) => c.id !== pendingDeleteCard.id));
    setPendingDeleteCard(null);
  }

  async function archiveCard(card: Card) {
    const next = !card.archived;
    await setCardArchived(db, card.id, next);
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, archived: next } : c)));
  }

  function navigateToEdit(card: Card) {
    router.push({
      pathname: '/deck/[id]/card/[cardId]/edit',
      params: { id: card.deckId, cardId: card.id },
    });
  }

  function enterSelectionMode() {
    setSelectionMode(true);
    setSelectedCardIds(new Set());
    setFocusedCardIndex(null);
  }
  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedCardIds(new Set());
    setFocusedCardIndex(null);
  }
  function toggleSelect(id: string) {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (selectedCardIds.size === displayedCards.length) setSelectedCardIds(new Set());
    else setSelectedCardIds(new Set(displayedCards.map((c) => c.id)));
  }

  const selectedCardsList = displayedCards.filter((c) => selectedCardIds.has(c.id));
  const allSelectedArchived = selectedCardsList.length > 0 && selectedCardsList.every((c) => c.archived);

  function handleRemoveTagSelected() {
    if (selectedCardIds.size === 0 || isProcessing) return;
    setShowRemoveTagModal(true);
  }
  async function doRemoveTag() {
    setShowRemoveTagModal(false);
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const ids = Array.from(selectedCardIds);
      await removeTagFromCards(db, tagId, ids);
      // タグを外したカードはこの一覧の対象外になるので除去する
      const idsSet = new Set(ids);
      setCards((prev) => prev.filter((c) => !idsSet.has(c.id)));
      exitSelectionMode();
    } finally {
      setIsProcessing(false);
    }
  }
  async function handleArchiveSelected() {
    if (selectedCardIds.size === 0 || isProcessing) return;
    setIsProcessing(true);
    try {
      const ids = Array.from(selectedCardIds);
      // 選択がすべてアーカイブ済みなら解除、それ以外はアーカイブ
      const next = !allSelectedArchived;
      await setCardsArchived(db, ids, next);
      const idsSet = new Set(ids);
      setCards((prev) => prev.map((c) => (idsSet.has(c.id) ? { ...c, archived: next } : c)));
      exitSelectionMode();
    } finally {
      setIsProcessing(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      lastFocusTimeRef.current = Date.now();
      getCardsByTagId(db, tagId).then((raw) => {
        if (cardSortOrder === 'newest') setCards([...raw].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.sortOrder - a.sortOrder));
        else if (cardSortOrder === 'oldest') setCards([...raw].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sortOrder - b.sortOrder));
        else setCards(raw);
      });
    }, [db, tagId, cardSortOrder])
  );

  // 034: 隠し TextInput を撤去しネイティブキーコマンドへ。CardStats 表示中（statsCardId）は
  // A のみ通す。それ以外は選択/通常モードで分岐（旧 onKeyPress/onSubmitEditing と同じ割り当て）。
  useKeyCommands([
    { input: 'j', handler: () => { if (statsCardId !== null) return; moveFocus('next'); } },
    { input: 'k', handler: () => { if (statsCardId !== null) return; moveFocus('prev'); } },
    {
      input: ' ',
      handler: () => {
        if (statsCardId !== null) return;
        if (selectionMode && focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
          toggleSelect(displayedCards[focusedCardIndex].id);
        }
      },
    },
    {
      input: 'a',
      handler: () => {
        if (statsCardId !== null) { setStatsCardId(null); return; }
        if (selectionMode) { toggleSelectAll(); return; }
        if (!isPro) return;
        if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
          setStatsCardId(displayedCards[focusedCardIndex].id);
        }
      },
    },
    { input: 't', handler: () => { if (statsCardId !== null) return; if (selectionMode) handleRemoveTagSelected(); } },
    { input: 'e', handler: () => { if (statsCardId !== null) return; if (selectionMode) handleArchiveSelected(); } },
    { input: 's', handler: () => { if (statsCardId !== null) return; if (selectionMode) exitSelectionMode(); else if (cards.length > 0) enterSelectionMode(); } },
    { input: '1', handler: () => { if (statsCardId !== null || selectionMode) return; setLastTagCardFilter('all'); } },
    { input: '2', handler: () => { if (statsCardId !== null || selectionMode) return; setLastTagCardFilter('active'); } },
    {
      input: 'p',
      handler: () => {
        if (statsCardId !== null || selectionMode) return;
        if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) navigateToEdit(displayedCards[focusedCardIndex]);
      },
    },
    {
      input: 'd',
      handler: () => {
        if (statsCardId !== null || selectionMode) return;
        if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) confirmDeleteCard(displayedCards[focusedCardIndex]);
      },
    },
    { input: 'n', handler: () => { if (statsCardId !== null || selectionMode) return; setShowDeckPicker(true); } },
    { input: 'b', handler: () => { if (statsCardId !== null || selectionMode) return; router.back(); } },
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (statsCardId !== null || selectionMode) return;
        if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) navigateToEdit(displayedCards[focusedCardIndex]);
      },
    },
    // 矢印キー: 上下=K/J（push 画面なので左右=,/. は無し）
    { input: KeyCommand.keyInputUpArrow, handler: () => { if (statsCardId !== null) return; moveFocus('prev'); } },
    { input: KeyCommand.keyInputDownArrow, handler: () => { if (statsCardId !== null) return; moveFocus('next'); } },
    // ESC: オーバーレイ → 選択モード解除 → 戻る
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (showDeckPicker) { setShowDeckPicker(false); return; }
        if (statsCardId !== null) { setStatsCardId(null); return; }
        if (showDeleteModal) { setShowDeleteModal(false); setPendingDeleteCard(null); return; }
        if (showRemoveTagModal) { setShowRemoveTagModal(false); return; }
        if (showTagCardsInfo) { setShowTagCardsInfo(false); return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
        if (selectionMode) { exitSelectionMode(); return; }
        router.back();
      },
    },
  ]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* インラインカスタムヘッダー */}
      <View style={{ height: initialTopInsetRef.current + 44, backgroundColor: theme.colors.surface }}>
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 44,
          flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
        }}>
          <Pressable
            onPress={keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
            style={{
              position: 'absolute', left: 0, right: 0,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
              paddingHorizontal: 56, gap: 4,
            }}
          >
            <Text
              style={{ color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: '600', flexShrink: 1, maxWidth: screenWidth * 0.46 }}
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {selectionMode ? t('shortcut.selectMode') : (tag?.name ?? '')}
            </Text>
            {keyboardShortcutsEnabled && (
              <MaterialIcons name="keyboard" size={20} color={theme.colors.primary} />
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
          {cards.length > 0 ? (
            <Pressable
              onPress={selectionMode ? exitSelectionMode : enterSelectionMode}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={4}
              accessibilityLabel={t('card.select')}
            >
              <Ionicons name={selectionMode ? 'close' : 'albums-outline'} size={26} color={theme.colors.primary} />
            </Pressable>
          ) : (
            <View style={{ width: 36 }} />
          )}
        </View>
      </View>

      <Pressable style={{ flex: 1 }} onPress={() => setFocusedCardIndex(null)}>
      {cards.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="card-outline" size={64} color={theme.colors.iconSubtle} />
          <Text style={[styles.emptyText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('deck.noCards')}
          </Text>
        </View>
      ) : (
      <>
        {/* フィルター：すべて（全件・青数字）／有効（アーカイブ除外・グレー数字） */}
        <View style={styles.filterRow}>
          <Pressable
            style={[
              styles.statItem,
              { backgroundColor: theme.colors.surface, width: blockWidth, minHeight: filterBlockMinHeight },
              lastTagCardFilter === 'all' && { margin: 0, borderWidth: 2, borderColor: theme.colors.primary },
              selectionMode && { opacity: 0.5 },
            ]}
            onPress={() => { if (!selectionMode) setLastTagCardFilter('all'); }}
          >
            <Text numberOfLines={1} allowFontScaling={false} style={[styles.statValue, { color: theme.colors.primary, fontSize: fontSizeForDigits(theme, (Platform as any).isPad ? 1 : String(cards.length).length) }]}>{cards.length}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('common.all')}</Text>
          </Pressable>
          <Pressable
            style={[
              styles.statItem,
              { backgroundColor: theme.colors.surface, width: blockWidth, minHeight: filterBlockMinHeight },
              lastTagCardFilter === 'active' && { margin: 0, borderWidth: 2, borderColor: theme.colors.primary },
              selectionMode && { opacity: 0.5 },
            ]}
            onPress={() => { if (!selectionMode) setLastTagCardFilter('active'); }}
          >
            <Text numberOfLines={1} allowFontScaling={false} style={[styles.statValue, { color: theme.colors.text, fontSize: fontSizeForDigits(theme, (Platform as any).isPad ? 1 : String(activeCardCount).length) }]}>{activeCardCount}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('common.active')}</Text>
          </Pressable>
        </View>
        {displayedCards.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="archive-outline" size={64} color={theme.colors.iconSubtle} />
          <Text style={[styles.emptyText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('card.noActiveCards')}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={displayedCards}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollsToTop={false}
          ListHeaderComponent={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, marginHorizontal: 20 }}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg, marginBottom: 0, marginHorizontal: 0 }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('tag.cardListTitle')}
              </Text>
              <Pressable onPress={() => setShowTagCardsInfo(true)} hitSlop={8} accessibilityLabel={t('tag.cardListInfoLabel')}>
                <Ionicons name="information-circle-outline" size={Math.max(theme.fontSize.lg, 20)} color={theme.colors.textTertiary} />
              </Pressable>
            </View>
          }
          ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedCardIndex(null)} />}
          renderItem={({ item, index }) => {
            const preview = getCardPreview(item.frontContent, t('card.imageBlock'));
            const isFocused = focusedCardIndex === index;
            const isSelected = selectedCardIds.has(item.id);
            const deck = decks.find((d) => d.id === item.deckId);
            const effectiveArchived = item.archived || !!deck?.archived;
            return (
              <SwipeToDeleteRow
                enabled={!selectionMode}
                onDelete={() => confirmDeleteCard(item)}
                onArchive={() => archiveCard(item)}
                archived={item.archived}
                containerStyle={styles.cardRowSpacing}
              >
                <Pressable
                  style={[
                    styles.cardItem,
                    { backgroundColor: theme.colors.surface },
                    effectiveArchived && { opacity: 0.55 },
                    selectionMode && isSelected && { borderWidth: 2, borderColor: theme.colors.primary },
                    selectionMode && isFocused && { borderWidth: 2, borderColor: '#F57C00' },
                    !selectionMode && isFocused && { borderWidth: 2, borderColor: theme.colors.primary },
                  ]}
                  onPress={() => {
                    if (selectionMode) {
                      setFocusedCardIndex(index);
                      toggleSelect(item.id);
                    } else {
                      setFocusedCardIndex(index);
                      navigateToEdit(item);
                    }
                  }}
                >
                  {selectionMode && (
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={isSelected ? theme.colors.primary : theme.colors.iconSubtle}
                    />
                  )}
                  <Text
                    style={[styles.cardPreview, { color: theme.colors.text, fontSize: theme.fontSize.lg, lineHeight: Math.ceil(theme.fontSize.lg * 1.5) }]}
                    numberOfLines={2}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {preview || t('card.noText')}
                  </Text>
                  {effectiveArchived && (
                    <Ionicons name="archive" size={theme.fontSize.lg} color={theme.colors.textTertiary} />
                  )}
                  {!selectionMode && (
                    <View style={[styles.cardActions, (Platform as any).isPad && { gap: 32 }]}>
                      {isPro && (
                        <Pressable onPress={() => { setFocusedCardIndex(index); setStatsCardId(item.id); }} hitSlop={8} style={styles.iconBtn}>
                          <Ionicons name="analytics-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
                        </Pressable>
                      )}
                      <Pressable onPress={() => { setFocusedCardIndex(index); navigateToEdit(item); }} hitSlop={8} style={styles.iconBtn}>
                        <Ionicons name="pencil-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
                      </Pressable>
                    </View>
                  )}
                </Pressable>
              </SwipeToDeleteRow>
            );
          }}
        />
        )}
      </>
      )}

      {!selectionMode && (
        <>
          {/* FAB: 戻る */}
          <Pressable
            style={[styles.fab, { left: 20, backgroundColor: theme.colors.primary }]}
            onPress={() => { if (Date.now() - lastFocusTimeRef.current >= 350) router.back(); }}
          >
            <Ionicons name="chevron-back" size={28} color="#FFF" />
          </Pressable>

          {/* FAB: 新規カード作成 */}
          <Pressable
            style={[styles.fab, { right: 20, backgroundColor: theme.colors.primary }]}
            onPress={() => setShowDeckPicker(true)}
          >
            <Ionicons name="add" size={28} color="#FFF" />
          </Pressable>
        </>
      )}
      </Pressable>

      {selectionMode && (
        <View style={[styles.selectionBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
          <Pressable onPress={toggleSelectAll} style={[styles.selIconBtn, { backgroundColor: theme.colors.primary }]} accessibilityLabel={t('card.selectAll')}>
            <Ionicons
              name={displayedCards.length > 0 && selectedCardIds.size === displayedCards.length ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={22}
              color="#FFF"
            />
          </Pressable>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('card.selectedCount', { count: selectedCardIds.size })}
          </Text>
          <View style={styles.selectionActions}>
            <Pressable
              style={[styles.selIconBtn, { backgroundColor: theme.colors.primary }, (selectedCardIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={handleRemoveTagSelected}
              disabled={selectedCardIds.size === 0 || isProcessing}
              accessibilityLabel={t('tag.removeFromCards')}
            >
              <Ionicons name="pricetag-outline" size={22} color="#FFF" />
            </Pressable>
            <Pressable
              style={[styles.selIconBtn, { backgroundColor: theme.colors.primary }, (selectedCardIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={handleArchiveSelected}
              disabled={selectedCardIds.size === 0 || isProcessing}
              accessibilityLabel={allSelectedArchived ? t('common.unarchive') : t('common.archive')}
            >
              <Ionicons name={allSelectedArchived ? 'archive' : 'archive-outline'} size={22} color="#FFF" />
            </Pressable>
          </View>
        </View>
      )}

      <DeckPickerModal
        visible={showDeckPicker}
        title={t('card.newCardDeckTitle')}
        decks={decks}
        onSelect={(deck) => { setShowDeckPicker(false); router.push({ pathname: '/deck/[id]/card/new', params: { id: deck.id, tagId } }); }}
        onClose={() => setShowDeckPicker(false)}
        showCardCount
        emptyMessage={t('study.noDecks')}
      />

      <CardStatsSheet cardId={statsCardId} onClose={() => setStatsCardId(null)} />
      <InfoModal
        visible={showTagCardsInfo}
        title={t('tag.cardListTitle')}
        message={<InfoContent text={t('tag.cardListInfoMessage')} />}
        onClose={() => setShowTagCardsInfo(false)}
      />
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        sections={selectionMode
          ? [{ title: t('shortcut.selectMode'), items: TAG_CARDS_SELECTION_SHORTCUTS }]
          : [{ title: t('shortcut.normalMode'), items: TAG_CARDS_SHORTCUTS }]}
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={deleteModalMessage}
        onConfirm={handleDeleteConfirm}
        onClose={() => { setShowDeleteModal(false); setPendingDeleteCard(null); }}
      />
      <ConfirmModal
        visible={showRemoveTagModal}
        message={t('tag.removeFromCardsConfirm', { count: selectedCardIds.size, name: tag?.name ?? '' })}
        actions={[
          { label: t('tag.removeFromCardsAction'), onPress: doRemoveTag },
        ]}
        onClose={() => setShowRemoveTagModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingTop: 16, paddingBottom: 96 },
  cardItem: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...SHADOW.subtle,
  },
  // カードの外側マージンは SwipeToDeleteRow のコンテナへ（スワイプ領域に余白を含めない）
  cardRowSpacing: {
    marginHorizontal: 20,
    marginBottom: 8,
  },
  sectionTitle: { fontWeight: '700', marginBottom: 12, marginHorizontal: 20 },
  filterRow: { flexDirection: 'row', gap: 4, marginHorizontal: 18, paddingTop: 16, paddingBottom: 4 },
  statItem: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 2,
    ...SHADOW.card,
  },
  statValue: { fontWeight: '700' },
  statLabel: { marginTop: 2, textAlign: 'center', fontWeight: '600' },
  cardPreview: { flex: 1 },
  cardActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  iconBtn: { padding: 4 },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  selectionActions: { flexDirection: 'row', gap: 8 },
  selIconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  fab: {
    position: 'absolute',
    right: 20,
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
  emptyText: {},
});
