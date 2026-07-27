import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeScrollsToTop } from '@/lib/useSafeScrollsToTop';
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

import { ArchivePill, useArchivePill } from '@/components/ArchivePill';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { DeckPickerModal } from '@/components/DeckPickerModal';
import { InfoModal } from '@/components/InfoModal';
import { InfoContent } from '@/components/InfoContent';
import { SwipeToDeleteRow } from '@/components/SwipeToDeleteRow';
import { CardStatsSheet } from '@/components/stats/CardStatsSheet';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW, fontSizeForDigits } from '@/lib/theme';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { deleteKeySpecs, useKeyCommands } from '@/lib/useKeyCommands';
import { useLockedHeaderHeights } from '@/lib/useLockedTopInset';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { useListNavigation } from '@/hooks/useListNavigation';
import { deleteCard, getCardsByTagId, setCardArchived, setCardsArchived } from '@/lib/database/cards';
import { removeTagFromCards } from '@/lib/database/tags';
import { getCardPreview } from '@/lib/cardPreview';
import { useSettingsStore } from '@/store/settings';
import { useProStore } from '@/store/pro';
import { useDeckStore } from '@/store/decks';
import { usePendingFocusStore } from '@/store/pendingFocus';
import { useTagStore } from '@/store/tags';
import type { Card } from '@/types';

const TAG_CARDS_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: '1 / 2', descKey: 'shortcut.switchFilterAllActive' },
    { key: 'S',     descKey: 'shortcut.toggleSelect' },
  ] },
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K',   descKey: 'shortcut.focusNextPrev' },
    { key: 'P',       descKey: 'shortcut.editFocusedItem' },
    { key: 'A',     descKey: 'shortcut.toggleCardStats', pro: true },
    { key: 'E',     descKey: 'shortcut.archiveFocused' },
    { key: 'Delete', descKey: 'shortcut.deleteFocused' },
  ] },
  { titleKey: 'shortcut.catNavigate', items: [
    { key: 'N',     descKey: 'shortcut.new' },
    { key: 'B',     descKey: 'shortcut.back' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC',   descKey: 'shortcut.esc' },
    { key: '?',     descKey: 'shortcut.showShortcuts' },
  ] },
];

const TAG_CARDS_SELECTION_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catDisplay', items: [
    { key: 'S',     descKey: 'shortcut.exitSelect' },
  ] },
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
    { key: 'Space', descKey: 'shortcut.toggleCheck' },
    { key: 'A',     descKey: 'shortcut.selectAll' },
    { key: 'T',     descKey: 'shortcut.removeTagSelected' },
    { key: 'E',     descKey: 'shortcut.archiveSelected' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC',   descKey: 'shortcut.esc' },
    { key: '?',     descKey: 'shortcut.showShortcuts' },
  ] },
];

export default function TagCardsScreen() {
  const { tagId } = useLocalSearchParams<{ tagId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  // 標準ヘッダーと同じ高さ算出（Dynamic Island 補正込み）。lib/useLockedTopInset.ts 参照。
  const headerHeights = useLockedHeaderHeights();
  useRestoreStatusBar();
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
  // ステータスバータップで先頭へ（iOS標準 scrollsToTop）。フォーカス中の画面だけ有効にする
  // （有効候補が複数あると iOS が機能を無効化するため）。さらに iPadOS 26 は scrollsToTop を
  // タップ無しで誤発火させる（ポップ遷移で戻ると一瞬ちらつく／iPad で選択モードを切り替えると
  // 最下部から先頭へ飛ぶ）。selectionMode を渡して、選択モードを切り替えたらこの画面にいる
  // あいだは二度と武装しないようにする（詳細は lib/useSafeScrollsToTop.ts）。
  const scrollsToTopArmed = useSafeScrollsToTop(selectionMode);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [showRemoveTagModal, setShowRemoveTagModal] = useState(false);

  // 実効アーカイブ（カード自身 or 所属デッキがアーカイブ）。「有効」フィルターで除外する。
  const isEffectivelyArchived = useCallback(
    (c: Card) => c.archived || !!decks.find((d) => d.id === c.deckId)?.archived,
    [decks],
  );
  const activeCardCount = useMemo(() => cards.filter((c) => !isEffectivelyArchived(c)).length, [cards, isEffectivelyArchived]);
  // フィルター切替の体感レスポンス改善（カード一覧 deck/[id]/index.tsx と同じ手法）:
  // ブロックのハイライトは即時に描画し、リスト本体のデータ入れ替え（保持セルの
  // 同期再構築＝カード数が多いと重い）は useDeferredValue で次のレンダーに分離する。
  const deferredFilter = useDeferredValue(lastTagCardFilter);
  const displayedCards = useMemo(
    () => (deferredFilter === 'active' ? cards.filter((c) => !isEffectivelyArchived(c)) : cards),
    [cards, deferredFilter, isEffectivelyArchived],
  );
  // ホームのフィルターブロックと同じ寸法（4列レイアウトの1ブロック幅）
  const blockWidth = (screenWidth - 56) / 4;
  const filterBlockMinHeight = 32 + Math.ceil(fontSizeForDigits(theme, 1) * 1.35) + 2 + Math.ceil(theme.fontSize.xs * 1.35);

  const { focusedIndex: focusedCardIndex, setFocusedIndex: setFocusedCardIndex, setFocusId, listRef, moveFocus } = useListNavigation(displayedCards, (c) => c.id);
  const { archivePill, showArchivePill } = useArchivePill();
  // 新規作成から戻った直後、その項目が一覧に現れたらフォーカス＋スクロールする用の保留 ID
  const pendingFocusCardIdRef = useRef<string | null>(null);
  const takePendingFocus = usePendingFocusStore((s) => s.takePendingFocus);

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
    // 操作した行にフォーカスを移す（行タップ/編集ボタンと同じ流儀。スワイプだけ例外にしない）。
    // 「有効」フィルターでは行が消えるが、focusedId は保持されるので「すべて」に戻せば
    // 青枠が復活する。scrollToIndex で追いかけるのは不可（カード一覧 archiveCard のコメント参照）。
    setFocusId(card.id);
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
    // フォーカス中の項目はカーソル（オレンジ枠）として残すが、初期選択はしない。
    // （フォーカス項目以外を選びたいケースが多く、自動チェックは誤選択を生むため）
    setSelectedCardIds(new Set());
  }
  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedCardIds(new Set());
    // カーソル（オレンジ枠）は通常モードのフォーカスへ引き継ぐ（消えた項目は ID 基準で自動的に null）
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
      // 新規作成から戻った場合の作成カード ID を保留（一覧再読込後に下の effect がフォーカス＋スクロール）
      pendingFocusCardIdRef.current = takePendingFocus('card');
      getCardsByTagId(db, tagId).then((raw) => {
        if (cardSortOrder === 'newest') setCards([...raw].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.sortOrder - a.sortOrder));
        else if (cardSortOrder === 'oldest') setCards([...raw].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sortOrder - b.sortOrder));
        else setCards(raw);
      });
    }, [db, tagId, cardSortOrder])
  );

  // 保留 ID の項目が一覧に現れたらフォーカス（オレンジではなく青枠＝通常フォーカス）＋スクロールする。
  useEffect(() => {
    const id = pendingFocusCardIdRef.current;
    if (!id) return;
    const idx = displayedCards.findIndex((c) => c.id === id);
    if (idx === -1) return;
    pendingFocusCardIdRef.current = null;
    setFocusId(id);
    setTimeout(() => (listRef.current as any)?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: false }), 60);
  }, [displayedCards, setFocusId, listRef]);

  // 034: 隠し TextInput を撤去しネイティブキーコマンドへ。CardStats 表示中（statsCardId）は
  // ←/→・,/.・H/L でフィルター（すべて/有効）を循環切替（タブ画面・カード一覧と同じ操作軸）。
  function cycleTagCardFilter(dir: 'prev' | 'next') {
    if (statsCardId !== null || selectionMode) return;
    const order = ['all', 'active'] as const;
    const i = order.indexOf(lastTagCardFilter);
    setLastTagCardFilter(order[((i < 0 ? 0 : i) + (dir === 'next' ? 1 : -1) + order.length) % order.length]);
  }

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
    // ⌘A = 全選択（選択モードのみ・OS 慣習のエイリアス）
    { input: 'a', modifierFlags: KeyCommand.keyModifierCommand, handler: () => { if (statsCardId !== null) return; if (selectionMode) toggleSelectAll(); } },
    { input: 't', handler: () => { if (statsCardId !== null) return; if (selectionMode) handleRemoveTagSelected(); } },
    // E = アーカイブ切替（全画面で E に統一）。Delete と同じ「選択モード＝選択カード／
    //   通常モード＝フォーカスカード」の流儀。「有効」フィルターではアーカイブすると
    //   その行が消えるため、キー操作にはピル通知を添える（スワイプはボタン表示があるので不要）。
    { input: 'e', handler: () => {
      if (statsCardId !== null) return;
      if (selectionMode) {
        handleArchiveSelected();
      } else if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
        const card = displayedCards[focusedCardIndex];
        archiveCard(card);
        showArchivePill(!card.archived);
      }
    } },
    { input: 's', handler: () => { if (statsCardId !== null) return; if (selectionMode) exitSelectionMode(); else if (cards.length > 0) enterSelectionMode(); } },
    { input: '1', handler: () => { if (statsCardId !== null || selectionMode) return; setLastTagCardFilter('all'); } },
    { input: '2', handler: () => { if (statsCardId !== null || selectionMode) return; setLastTagCardFilter('active'); } },
    // ←/→・,/.・H/L = フィルター切替（すべて/有効）
    { input: ',', handler: () => cycleTagCardFilter('prev') },
    { input: '.', handler: () => cycleTagCardFilter('next') },
    { input: 'h', handler: () => cycleTagCardFilter('prev') },
    { input: 'l', handler: () => cycleTagCardFilter('next') },
    {
      input: 'p',
      handler: () => {
        if (statsCardId !== null || selectionMode) return;
        if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) navigateToEdit(displayedCards[focusedCardIndex]);
      },
    },
    ...deleteKeySpecs(() => {
      if (statsCardId !== null || selectionMode) return;
      if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) confirmDeleteCard(displayedCards[focusedCardIndex]);
    }),
    { input: 'n', handler: () => { if (statsCardId !== null || selectionMode) return; setShowDeckPicker(true); } },
    { input: 'b', handler: () => { if (statsCardId !== null || selectionMode) return; router.back(); } },
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (statsCardId !== null || selectionMode) return;
        if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) navigateToEdit(displayedCards[focusedCardIndex]);
      },
    },
    // 矢印キー: 上下=K/J（フォーカス移動）、左右=,/.（フィルター切替）
    { input: KeyCommand.keyInputUpArrow, handler: () => { if (statsCardId !== null) return; moveFocus('prev'); } },
    { input: KeyCommand.keyInputDownArrow, handler: () => { if (statsCardId !== null) return; moveFocus('next'); } },
    { input: KeyCommand.keyInputLeftArrow, handler: () => cycleTagCardFilter('prev') },
    { input: KeyCommand.keyInputRightArrow, handler: () => cycleTagCardFilter('next') },
    // ?（Shift+/）= ショートカット一覧を開く（閉じる/トグルは ShortcutsModal 側が担当）
    { input: '/', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (statsCardId !== null) return; setShowShortcutsModal((v) => !v); } },
  // 削除確認/タグ外し確認/情報/ショートカット/デッキ選択 表示中は背景ナビを解除（統計シートは A トグルのため
  // 除外＝各ナビは statsCardId を個別ガード済み）。Esc は別フックで常時有効。
  ], !showDeckPicker && !showDeleteModal && !showRemoveTagModal && !showTagCardsInfo && !showShortcutsModal);

  // ESC は常時有効：デッキ選択はピッカー側に委譲、以降オーバーレイ → 選択モード解除 → 戻る。削除系は Return 非割当。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (showDeckPicker) return; // DeckPickerModal 側の Esc が閉じる
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

  // 「OK のみ」アラート（情報/ショートカット一覧）は Return=OK（閉じる）。表示中のみ有効（main は解除済み）。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (showTagCardsInfo) { setShowTagCardsInfo(false); return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
      },
    },
  ], showTagCardsInfo || showShortcutsModal);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* インラインカスタムヘッダー */}
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

      {/* 余白タップ解除は固定部（フィルター行）とリスト内フッターに分けて配置。
          リストの祖先 Pressable はスクロール不能の原因になる（統計参照）。 */}
      <View style={{ flex: 1 }}>
      {cards.length === 0 ? (
        <Pressable style={styles.empty} onPress={() => setFocusedCardIndex(null)}>
          <Ionicons name="card-outline" size={64} color={theme.colors.iconSubtle} />
          <Text style={[styles.emptyText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {t('deck.noCards')}
          </Text>
        </Pressable>
      ) : (
      <>
        {/* フィルター：すべて（全件・青数字）／有効（アーカイブ除外・グレー数字） */}
        <Pressable style={styles.filterRow} onPress={() => setFocusedCardIndex(null)}>
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
        </Pressable>
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
          onScrollToIndexFailed={(info) => {
            (listRef.current as any)?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => (listRef.current as any)?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false }), 100);
          }}
          contentContainerStyle={styles.list}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollsToTop={scrollsToTopArmed}
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
      </View>

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
        subtitle={selectionMode ? t('shortcut.selectMode') : t('shortcut.normalMode')}
        sections={(selectionMode ? TAG_CARDS_SELECTION_SHORTCUT_SECTIONS : TAG_CARDS_SHORTCUT_SECTIONS)
          .map((s) => ({ title: t(s.titleKey), items: s.items }))}
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
      <ArchivePill archived={archivePill} />
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
