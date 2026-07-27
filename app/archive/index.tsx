import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArchivePill, useArchivePill } from '@/components/ArchivePill';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { DeckIcon } from '@/components/DeckIcon';
import { EmptyState } from '@/components/EmptyState';
import { SwipeToDeleteRow } from '@/components/SwipeToDeleteRow';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { getCardPreview } from '@/lib/cardPreview';
import { deleteCardsBulk, getArchivedCards, setCardsArchived } from '@/lib/database/cards';
import { deleteDecksBulk, getAllDecks, setDecksArchived } from '@/lib/database/decks';
import { fontSizeForDigits, MAX_FONT_MULTIPLIER, SHADOW, useTheme } from '@/lib/theme';
import { deleteKeySpecs, useKeyCommands } from '@/lib/useKeyCommands';
import { useLockedHeaderHeights } from '@/lib/useLockedTopInset';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { useSafeScrollsToTop } from '@/lib/useSafeScrollsToTop';
import { useListNavigation } from '@/hooks/useListNavigation';
import { useDeckStore } from '@/store/decks';
import { useSettingsStore } from '@/store/settings';
import { useSyncStore } from '@/store/sync';
import type { Card, Deck } from '@/types';

type ArchiveTab = 'decks' | 'cards';

const ARCHIVE_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: '1 / 2', descKey: 'shortcut.switchArchiveTab' },
    { key: 'S',     descKey: 'shortcut.toggleSelect' },
  ] },
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K',  descKey: 'shortcut.focusNextPrev' },
    { key: 'E',      descKey: 'shortcut.unarchiveFocused' },
    { key: 'Delete', descKey: 'shortcut.deleteFocused' },
  ] },
  { titleKey: 'shortcut.catNavigate', items: [
    { key: 'Return', descKey: 'shortcut.openFocused' },
    { key: 'B',      descKey: 'shortcut.back' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC', descKey: 'shortcut.esc' },
    { key: '?',   descKey: 'shortcut.showShortcuts' },
  ] },
];

const ARCHIVE_SELECTION_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: 'S', descKey: 'shortcut.exitSelect' },
  ] },
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K',  descKey: 'shortcut.focusNextPrev' },
    { key: 'Space',  descKey: 'shortcut.toggleCheck' },
    { key: 'A',      descKey: 'shortcut.selectAll' },
    { key: 'E',      descKey: 'shortcut.unarchiveSelected' },
    { key: 'Delete', descKey: 'shortcut.deleteSelectedItems' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC', descKey: 'shortcut.esc' },
    { key: '?',   descKey: 'shortcut.showShortcuts' },
  ] },
];

/**
 * アーカイブ一覧（042）。アーカイブ済みのデッキ／カードを1か所に集め、
 * まとめて解除・削除できるようにする整理用の画面。
 *
 * - デッキタブ: `decks.archived`（ストアから取得＝クエリ不要）
 * - カードタブ: `cards.archived = 1` のカードのみ。アーカイブ済みデッキ配下の
 *   「実効アーカイブ」カードは含めない（それはデッキタブで解除/削除する対象）
 * - 全行がアーカイブ済みなので一覧慣習のグレー表示（opacity 0.55）は使わない
 *   （全部灰色では区別にならないため）。右端の archive アイコンだけで示す。
 */
export default function ArchiveScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const headerHeights = useLockedHeaderHeights();
  useRestoreStatusBar();
  const lastFocusTimeRef = useRef(0);
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { decks, setDecks, updateDeck, removeDeck } = useDeckStore();
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const dataRevision = useSyncStore((s) => s.dataRevision);

  const [tab, setTab] = useState<ArchiveTab>('decks');
  const [archivedCards, setArchivedCards] = useState<Card[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  // iPadOS 26 は scrollsToTop をタップ無しで誤発火させる（iPad で選択モードを切り替えると
  // 最下部から先頭へ飛ぶ）。selectionMode を渡して切替後は再武装しない。
  const scrollsToTopArmed = useSafeScrollsToTop(selectionMode);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteModalMessage, setDeleteModalMessage] = useState('');
  // 削除実行は「単一行」「選択分の一括」で中身が違うので、確定時に呼ぶ関数を持たせる
  const pendingDeleteRef = useRef<(() => Promise<void>) | null>(null);
  const { archivePill, showArchivePill } = useArchivePill();

  const archivedDecks = useMemo(() => decks.filter((d) => d.archived), [decks]);
  const items: (Deck | Card)[] = tab === 'decks' ? archivedDecks : archivedCards;

  const { focusedIndex, setFocusedIndex, listRef, moveFocus } = useListNavigation(items, (item) => item.id);

  const reloadCards = useCallback(() => {
    getArchivedCards(db).then(setArchivedCards).catch(() => {});
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      lastFocusTimeRef.current = Date.now();
      reloadCards();
    }, [reloadCards])
  );

  // iCloud 同期でデータが入れ替わったら読み直す（他画面と同じ流儀）
  useEffect(() => {
    if (dataRevision === 0) return;
    reloadCards();
    getAllDecks(db).then(setDecks).catch(() => {});
  }, [dataRevision, db, reloadCards, setDecks]);

  function switchTab(next: ArchiveTab) {
    if (next === tab) return;
    setTab(next);
    // タブをまたいだ選択は意味を持たない（デッキとカードで操作が別）ので必ず解除する
    setSelectedIds(new Set());
    setFocusedIndex(null);
  }
  // 横方向の切替（,/. ・H/L・←/→）。2タブなので前後どちらも反対側へ移る。
  function cycleTab() {
    if (selectionMode) return;
    switchTab(tab === 'decks' ? 'cards' : 'decks');
  }

  function enterSelectionMode() {
    setSelectionMode(true);
    setSelectedIds(new Set());
  }
  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (selectedIds.size === items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map((i) => i.id)));
  }

  // ---- 解除（可逆なので確認なし。行が一覧から消えるのでピルで通知する）----
  async function unarchiveDecks(ids: string[]) {
    if (ids.length === 0 || isProcessing) return;
    setIsProcessing(true);
    try {
      await setDecksArchived(db, ids, false);
      for (const id of ids) {
        const deck = decks.find((d) => d.id === id);
        if (deck) updateDeck({ ...deck, archived: false });
      }
      showArchivePill(false);
    } finally {
      setIsProcessing(false);
    }
  }
  async function unarchiveCards(ids: string[]) {
    if (ids.length === 0 || isProcessing) return;
    setIsProcessing(true);
    try {
      await setCardsArchived(db, ids, false);
      const idsSet = new Set(ids);
      setArchivedCards((prev) => prev.filter((c) => !idsSet.has(c.id)));
      showArchivePill(false);
    } finally {
      setIsProcessing(false);
    }
  }

  // ---- 削除（非可逆。件数を明示した確認を必ず挟む）----
  function confirmDelete(message: string, run: () => Promise<void>) {
    setDeleteModalMessage(message);
    pendingDeleteRef.current = run;
    setShowDeleteModal(true);
  }
  async function handleDeleteConfirm() {
    setShowDeleteModal(false);
    const run = pendingDeleteRef.current;
    pendingDeleteRef.current = null;
    if (!run || isProcessing) return;
    setIsProcessing(true);
    try {
      await run();
    } finally {
      setIsProcessing(false);
    }
  }
  async function doDeleteDecks(ids: string[]) {
    await deleteDecksBulk(db, ids);
    for (const id of ids) removeDeck(id);
    exitSelectionMode();
  }
  async function doDeleteCards(cards: Card[]) {
    const ids = cards.map((c) => c.id);
    await deleteCardsBulk(db, ids, cards.map((c) => c.deckId));
    const idsSet = new Set(ids);
    setArchivedCards((prev) => prev.filter((c) => !idsSet.has(c.id)));
    // cardCount は DB 側で数え直されるのでストアも取り込む（ホームのバッジ表示用）
    await getAllDecks(db).then(setDecks).catch(() => {});
    exitSelectionMode();
  }

  function confirmDeleteDeck(deck: Deck) {
    confirmDelete(t('deck.deleteConfirm', { name: deck.name }), () => doDeleteDecks([deck.id]));
  }
  function confirmDeleteCard(card: Card) {
    const rawPreview = getCardPreview(card.frontContent, t('card.imageBlock')).replace(/\n/g, ' ');
    const preview = rawPreview || t('card.noText');
    const name = preview.length > 20 ? preview.slice(0, 20) + '…' : preview;
    confirmDelete(t('card.deleteConfirm', { name }), () => doDeleteCards([card]));
  }
  function confirmDeleteSelected() {
    if (selectedIds.size === 0 || isProcessing) return;
    if (tab === 'decks') {
      const ids = archivedDecks.filter((d) => selectedIds.has(d.id)).map((d) => d.id);
      const cardCount = archivedDecks.filter((d) => selectedIds.has(d.id)).reduce((s, d) => s + d.cardCount, 0);
      confirmDelete(t('archive.deleteDecksConfirm', { count: ids.length, cardCount }), () => doDeleteDecks(ids));
    } else {
      const cards = archivedCards.filter((c) => selectedIds.has(c.id));
      confirmDelete(t('card.deleteSelectedConfirm', { count: cards.length }), () => doDeleteCards(cards));
    }
  }

  // ---- 行操作（スワイプ・キー共通）----
  function unarchiveFocused() {
    if (focusedIndex === null || !items[focusedIndex]) return;
    const item = items[focusedIndex];
    if (tab === 'decks') unarchiveDecks([item.id]);
    else unarchiveCards([item.id]);
  }
  function deleteFocused() {
    if (focusedIndex === null || !items[focusedIndex]) return;
    if (tab === 'decks') confirmDeleteDeck(items[focusedIndex] as Deck);
    else confirmDeleteCard(items[focusedIndex] as Card);
  }
  function openFocused() {
    if (focusedIndex === null || !items[focusedIndex]) return;
    openItem(items[focusedIndex]);
  }
  function openItem(item: Deck | Card) {
    if (tab === 'decks') {
      router.push({ pathname: '/deck/[id]', params: { id: item.id } });
    } else {
      const card = item as Card;
      router.push({ pathname: '/deck/[id]/card/[cardId]/edit', params: { id: card.deckId, cardId: card.id } });
    }
  }
  function unarchiveSelected() {
    const ids = Array.from(selectedIds);
    if (tab === 'decks') unarchiveDecks(ids);
    else unarchiveCards(ids);
    exitSelectionMode();
  }

  // ---- キーボード（034）----
  const overlayOpen = showDeleteModal || showShortcutsModal;
  useKeyCommands([
    { input: 'j', handler: () => moveFocus('next') },
    { input: 'k', handler: () => moveFocus('prev') },
    { input: KeyCommand.keyInputUpArrow, handler: () => moveFocus('prev') },
    { input: KeyCommand.keyInputDownArrow, handler: () => moveFocus('next') },
    {
      input: ' ',
      handler: () => {
        if (selectionMode && focusedIndex !== null && items[focusedIndex]) toggleSelect(items[focusedIndex].id);
      },
    },
    { input: 'a', handler: () => { if (selectionMode) toggleSelectAll(); } },
    { input: 'a', modifierFlags: KeyCommand.keyModifierCommand, handler: () => { if (selectionMode) toggleSelectAll(); } },
    // E = アーカイブ解除（全画面で E に統一。選択モード＝選択分／通常＝フォーカス行）
    { input: 'e', handler: () => { if (selectionMode) unarchiveSelected(); else unarchiveFocused(); } },
    ...deleteKeySpecs(() => { if (selectionMode) confirmDeleteSelected(); else deleteFocused(); }),
    { input: 's', handler: () => { if (selectionMode) exitSelectionMode(); else if (items.length > 0) enterSelectionMode(); } },
    { input: '1', handler: () => { if (!selectionMode) switchTab('decks'); } },
    { input: '2', handler: () => { if (!selectionMode) switchTab('cards'); } },
    { input: ',', handler: cycleTab },
    { input: '.', handler: cycleTab },
    { input: 'h', handler: cycleTab },
    { input: 'l', handler: cycleTab },
    { input: KeyCommand.keyInputLeftArrow, handler: cycleTab },
    { input: KeyCommand.keyInputRightArrow, handler: cycleTab },
    { input: KeyCommand.keyInputEnter, handler: () => { if (!selectionMode) openFocused(); } },
    { input: 'b', handler: () => { if (!selectionMode) router.back(); } },
    { input: '/', modifierFlags: KeyCommand.keyModifierShift, handler: () => setShowShortcutsModal((v) => !v) },
  // 削除確認/ショートカット一覧の表示中は背景ナビを解除。Esc は別フックで常時有効。
  ], !overlayOpen);

  // ESC は常時有効：オーバーレイ → 選択モード解除 → 戻る（削除確認は確定操作なので Return 非割当）
  useKeyCommands([
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (showDeleteModal) { setShowDeleteModal(false); pendingDeleteRef.current = null; return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
        if (selectionMode) { exitSelectionMode(); return; }
        router.back();
      },
    },
  ]);

  // 「OK のみ」アラート（ショートカット一覧）は Return=閉じる。表示中のみ有効（main は解除済み）。
  useKeyCommands([
    { input: KeyCommand.keyInputEnter, handler: () => setShowShortcutsModal(false) },
  ], showShortcutsModal);

  // ホームのフィルターブロックと同じ寸法（4列レイアウトの1ブロック幅）
  const blockWidth = (screenWidth - 56) / 4;
  const filterBlockMinHeight = 32 + Math.ceil(fontSizeForDigits(theme, 1) * 1.35) + 2 + Math.ceil(theme.fontSize.xs * 1.35);

  const renderTabBlock = (key: ArchiveTab, count: number, label: string) => (
    <Pressable
      style={[
        styles.statItem,
        { backgroundColor: theme.colors.surface, width: blockWidth, minHeight: filterBlockMinHeight },
        tab === key && { margin: 0, borderWidth: 2, borderColor: theme.colors.primary },
        selectionMode && { opacity: 0.5 },
      ]}
      onPress={() => { if (!selectionMode) switchTab(key); }}
    >
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={[styles.statValue, { color: tab === key ? theme.colors.primary : theme.colors.text, fontSize: fontSizeForDigits(theme, (Platform as any).isPad ? 1 : String(count).length) }]}
      >
        {count}
      </Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
        {label}
      </Text>
    </Pressable>
  );

  const renderRow = ({ item, index }: { item: Deck | Card; index: number }) => {
    const isFocused = focusedIndex === index;
    const isSelected = selectedIds.has(item.id);
    const deck = tab === 'decks' ? (item as Deck) : null;
    const card = tab === 'cards' ? (item as Card) : null;
    const ownerDeck = card ? decks.find((d) => d.id === card.deckId) : null;
    const label = deck
      ? deck.name
      : getCardPreview(card!.frontContent, t('card.imageBlock')) || t('card.noText');
    return (
      <SwipeToDeleteRow
        enabled={!selectionMode}
        onDelete={() => (deck ? confirmDeleteDeck(deck) : confirmDeleteCard(card!))}
        onArchive={() => (deck ? unarchiveDecks([deck.id]) : unarchiveCards([card!.id]))}
        archived
        containerStyle={styles.rowSpacing}
      >
        <Pressable
          style={[
            styles.row,
            { backgroundColor: theme.colors.surface },
            selectionMode && isSelected && { borderWidth: 2, borderColor: theme.colors.primary },
            selectionMode && isFocused && { borderWidth: 2, borderColor: '#F57C00' },
            !selectionMode && isFocused && { borderWidth: 2, borderColor: theme.colors.primary },
          ]}
          onPress={() => {
            setFocusedIndex(index);
            if (selectionMode) toggleSelect(item.id);
            else openItem(item);
          }}
        >
          {selectionMode && (
            <Ionicons
              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={isSelected ? theme.colors.primary : theme.colors.iconSubtle}
            />
          )}
          {deck && <DeckIcon iconName={deck.iconName ?? 'albums-outline'} colorHex={deck.colorHex} />}
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={{ color: theme.colors.text, fontSize: theme.fontSize.lg }}
              numberOfLines={2}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {label}
            </Text>
            <Text
              style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }}
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}
            >
              {deck ? t('common.cardsCount', { count: deck.cardCount }) : (ownerDeck?.name ?? '')}
            </Text>
          </View>
          <Ionicons name="archive" size={theme.fontSize.lg} color={theme.colors.textTertiary} />
        </Pressable>
      </SwipeToDeleteRow>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* インラインカスタムヘッダー（push 遷移画面の慣習。CLAUDE.md 参照） */}
      <View style={{ height: headerHeights.total, backgroundColor: theme.colors.surface }}>
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: headerHeights.content,
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
              {selectionMode ? t('shortcut.selectMode') : t('archive.title')}
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
          {items.length > 0 ? (
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

      <View style={{ flex: 1 }}>
        {/* 余白タップでのフォーカス解除は「固定部」と「リスト内フッター」に分ける。
            リストの祖先を Pressable にするとドラッグでスクロールできなくなる（CLAUDE.md）。 */}
        <Pressable style={styles.tabRow} onPress={() => setFocusedIndex(null)}>
          {renderTabBlock('decks', archivedDecks.length, t('archive.decks'))}
          {renderTabBlock('cards', archivedCards.length, t('archive.cards'))}
        </Pressable>

        {/* セクションタイトル（カード一覧・タグカード一覧と同じ慣習）。タブブロックと一覧の境目を示す */}
        <Pressable style={styles.sectionTitleRow} onPress={() => setFocusedIndex(null)}>
          <Text
            style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
          >
            {tab === 'decks' ? t('archive.deckListTitle') : t('archive.cardListTitle')}
          </Text>
        </Pressable>

        {items.length === 0 ? (
          <Pressable style={styles.empty} onPress={() => setFocusedIndex(null)}>
            <EmptyState
              icon="archive-outline"
              title={tab === 'decks' ? t('archive.noDecks') : t('archive.noCards')}
              subtitle={tab === 'decks' ? t('archive.noDecksSub') : t('archive.noCardsSub')}
            />
          </Pressable>
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderRow}
            contentContainerStyle={styles.list}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            automaticallyAdjustsScrollIndicatorInsets={false}
            scrollsToTop={scrollsToTopArmed}
            onScrollToIndexFailed={(info) => {
              (listRef.current as any)?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
              setTimeout(() => (listRef.current as any)?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false }), 100);
            }}
            ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedIndex(null)} />}
          />
        )}
      </View>

      {/* 左下フローティング戻るボタン（設定サブ画面・カード一覧・タグ管理と同パターン）。
          選択モードでは下部バーが出るので隠す。 */}
      {!selectionMode && (
        <Pressable
          style={[styles.fab, { left: 20, bottom: Math.max(insets.bottom, 16) + 16, backgroundColor: theme.colors.primary }]}
          onPress={() => { if (Date.now() - lastFocusTimeRef.current >= 350) router.back(); }}
          hitSlop={6}
        >
          <Ionicons name="chevron-back" size={28} color="#FFF" />
        </Pressable>
      )}

      {selectionMode && (
        <View style={[styles.selectionBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
          <Pressable onPress={toggleSelectAll} style={[styles.selIconBtn, { backgroundColor: theme.colors.primary }]} accessibilityLabel={t('card.selectAll')}>
            <Ionicons
              name={items.length > 0 && selectedIds.size === items.length ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={22}
              color="#FFF"
            />
          </Pressable>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('card.selectedCount', { count: selectedIds.size })}
          </Text>
          <View style={styles.selectionActions}>
            <Pressable
              style={[styles.selIconBtn, { backgroundColor: theme.colors.primary }, (selectedIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={unarchiveSelected}
              disabled={selectedIds.size === 0 || isProcessing}
              accessibilityLabel={t('common.unarchive')}
            >
              <Ionicons name="arrow-undo-outline" size={22} color="#FFF" />
            </Pressable>
            <Pressable
              style={[styles.selIconBtn, { backgroundColor: '#E53935' }, (selectedIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={confirmDeleteSelected}
              disabled={selectedIds.size === 0 || isProcessing}
              accessibilityLabel={t('common.delete')}
            >
              <Ionicons name="trash-outline" size={22} color="#FFF" />
            </Pressable>
          </View>
        </View>
      )}

      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        subtitle={selectionMode ? t('shortcut.selectMode') : t('shortcut.normalMode')}
        sections={(selectionMode ? ARCHIVE_SELECTION_SHORTCUT_SECTIONS : ARCHIVE_SHORTCUT_SECTIONS)
          .map((s) => ({ title: t(s.titleKey), items: s.items }))}
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={deleteModalMessage}
        onConfirm={handleDeleteConfirm}
        onClose={() => { setShowDeleteModal(false); pendingDeleteRef.current = null; }}
      />
      <ArchivePill archived={archivePill} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingBottom: 96 },
  tabRow: { flexDirection: 'row', gap: 4, marginHorizontal: 18, paddingTop: 16, paddingBottom: 4 },
  sectionTitleRow: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 },
  sectionTitle: { fontWeight: '700' },
  fab: {
    position: 'absolute',
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
  row: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...SHADOW.subtle,
  },
  // 行の外側マージンは SwipeToDeleteRow のコンテナへ（スワイプ領域に余白を含めない）
  rowSpacing: { marginHorizontal: 20, marginBottom: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
});
