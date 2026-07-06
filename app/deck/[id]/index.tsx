import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
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
import { constants as KeyCommand } from 'react-native-key-command';

import { resolveDeckIconColors } from '@/lib/deckIconColors';
import { useTheme, FILTER_COLORS, MAX_FONT_MULTIPLIER, SHADOW, fontSizeForDigits, themedFrameBorder, type AppTheme } from '@/lib/theme';
import {
  deleteCard,
  deleteCardsBulk,
  duplicateCard,
  getCardsByDeckId,
  getUnlearnedCardIdsByDeckId,
  getUnlearnedCountByDeck,
  moveCardsToDeck,
  setCardArchived,
  setCardsArchived,
  updateCardSortOrders,
} from '@/lib/database/cards';
import {
  getDueCardIdsByDeckId,
  getDueCountByDeck,
  getTodayReviewedCardIdsByDeckId,
  getTodayReviewedCountByDeck,
} from '@/lib/database/reviews';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { SwipeToDeleteRow } from '@/components/SwipeToDeleteRow';
import { ConfirmModal } from '@/components/ConfirmModal';
import { InfoModal } from '@/components/InfoModal';
import { InfoContent } from '@/components/InfoContent';
import { DeckPickerModal } from '@/components/DeckPickerModal';
import { EmptyState } from '@/components/EmptyState';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { CardStatsSheet } from '@/components/stats/CardStatsSheet';
import { deleteKeySpecs, useKeyCommands } from '@/lib/useKeyCommands';
import { useLockedTopInset } from '@/lib/useLockedTopInset';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { createDeck } from '@/lib/database/decks';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';
import { usePendingFocusStore } from '@/store/pendingFocus';
import { useReviewStore } from '@/store/reviews';
import { useSyncStore } from '@/store/sync';
import { useSettingsStore, preferenceToFilter } from '@/store/settings';
import { useProStore } from '@/store/pro';
import type { CardSortOrder, DeckDetailFilter } from '@/store/settings';
import { getCardPreview } from '@/lib/cardPreview';
import type { Card, Deck } from '@/types';

type FilterKey = DeckDetailFilter;

// カード行を memo 化し、フォーカス変更時に「枠が変わる2枚」だけ再描画されるようにする
// （100枚超でも J/K のフォーカス反映が遅れない）。ドラッグ経路（ScaleDecorator）は renderItem 側に
// 残してあり、この memo はその内側だけを対象にするため並べ替えのアニメーションには影響しない。
// 比較は「描画に効くフィールド」のみ。callbacks は親で useCallback 済み・drag は同一セル内で有効なので比較対象外。
type CardRowProps = {
  item: Card;
  drag: () => void;
  isFocused: boolean;
  isSelected: boolean;
  isSelMode: boolean;
  isNew: boolean;
  effectiveArchived: boolean;
  swipeEnabled: boolean;
  isPro: boolean;
  theme: AppTheme;
  themeKey: string;
  imageLabel: string;
  noTextLabel: string;
  onPress: (item: Card) => void;
  onLongPress: (item: Card, drag: () => void) => void;
  onStats: (item: Card) => void;
  onEdit: (item: Card) => void;
  onDelete: (item: Card) => void;
  onArchive: (item: Card) => void;
  onStudyFromHere: (item: Card) => void;
};

const CardRow = memo(function CardRow(props: CardRowProps) {
  const {
    item, drag, isFocused, isSelected, isSelMode, isNew, effectiveArchived, swipeEnabled,
    isPro, theme, imageLabel, noTextLabel, onPress, onLongPress, onStats, onEdit, onDelete, onArchive, onStudyFromHere,
  } = props;
  const preview = getCardPreview(item.frontContent, imageLabel);
  return (
    <SwipeToDeleteRow
      enabled={swipeEnabled}
      onDelete={() => onDelete(item)}
      onArchive={() => onArchive(item)}
      // 右スワイプ「ここから学習」。選択モードでは出さない（swipeEnabled が false なので実質不要だが明示）。
      onStudyFromHere={isSelMode ? undefined : () => onStudyFromHere(item)}
      archived={item.archived}
      containerStyle={styles.cardRowSpacing}
    >
      <Pressable
        style={[
          styles.cardItem,
          { backgroundColor: theme.colors.surface },
          effectiveArchived && { opacity: 0.55 },
          isSelMode && isSelected && { borderWidth: 2, borderColor: theme.colors.primary },
          isSelMode && isFocused && { borderWidth: 2, borderColor: '#F57C00' },
          !isSelMode && isFocused && { borderWidth: 2, borderColor: theme.colors.primary },
        ]}
        onPress={() => onPress(item)}
        onLongPress={() => onLongPress(item, drag)}
      >
        {isSelMode && (
          <Ionicons
            name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={isSelected ? theme.colors.primary : theme.colors.iconSubtle}
          />
        )}
        {/* lineHeight を明示すると小フォント時に行ボックスが不足して2行目がクリップされるため指定しない。 */}
        <Text style={[styles.cardPreview, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {preview || noTextLabel}
        </Text>
        {isNew && (
          <View style={[styles.newBadge, { backgroundColor: theme.colors.primary }]}>
            <Text allowFontScaling={false} style={[styles.newBadgeText, { color: theme.colors.primaryText, fontSize: theme.fontSize.xs }]}>NEW</Text>
          </View>
        )}
        {effectiveArchived && (
          <Ionicons name="archive" size={theme.fontSize.lg} color={theme.colors.textTertiary} />
        )}
        {!isSelMode && (
          <View style={[styles.cardActions, (Platform as any).isPad && { gap: 32 }]}>
            {isPro && (
              <Pressable onPress={() => onStats(item)} hitSlop={8} style={{ padding: 4 }}>
                <Ionicons name="analytics-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
              </Pressable>
            )}
            <Pressable onPress={() => onEdit(item)} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="pencil-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
            </Pressable>
          </View>
        )}
      </Pressable>
    </SwipeToDeleteRow>
  );
}, (prev, next) =>
  prev.item === next.item &&
  prev.isFocused === next.isFocused &&
  prev.isSelected === next.isSelected &&
  prev.isSelMode === next.isSelMode &&
  prev.isNew === next.isNew &&
  prev.effectiveArchived === next.effectiveArchived &&
  prev.swipeEnabled === next.swipeEnabled &&
  prev.isPro === next.isPro &&
  prev.themeKey === next.themeKey &&
  prev.imageLabel === next.imageLabel &&
  prev.noTextLabel === next.noTextLabel,
);

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  // useTheme() は毎レンダー新しいオブジェクトを返すため、renderItem の deps に直接入れると
  // 毎レンダー renderItem が作り直され全セルが再描画される（並べ替えドロップ時のちらつき要因）。
  // ref 経由で参照し、テーマ変更時は extraData で再描画を促す。
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const { width: screenWidth } = useWindowDimensions();
  const lockedTopInset = useLockedTopInset();
  useRestoreStatusBar();
  const { decks, updateDeck, addDeck } = useDeckStore();
  const { cards, setCards, removeCard, reorderCards, takeDuplicated } = useCardStore();
  const takePendingFocus = usePendingFocusStore((s) => s.takePendingFocus);
  const setStudyCardIds = useReviewStore((s) => s.setStudyCardIds);
  const { initialFilterPreference, lastDeckDetailFilter, setLastDeckDetailFilter, keyboardShortcutsEnabled, cardSortOrder, setCardSortOrder, manualSortLocked, setManualSortLocked } = useSettingsStore();
  const { isPro } = useProStore();
  const [statsCardId, setStatsCardId] = useState<string | null>(null);
  const [todayReviewed, setTodayReviewed] = useState<number | null>(null);
  const [dueCount, setDueCount] = useState<number | null>(null);
  const [unlearnedCount, setUnlearnedCount] = useState<number | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>(
    () => preferenceToFilter(initialFilterPreference) ?? lastDeckDetailFilter,
  );
  const lastFocusTimeRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const savedScrollOffsetRef = useRef(0);
  const restorationEndTimeRef = useRef(0);
  // 複製で戻ってきた直後にスクロールしたい複製先（A'）の ID。一覧に現れ次第そこへスクロールする。
  const pendingScrollToIdRef = useRef<string | null>(null);
  const filterOffsetsRef = useRef<Record<FilterKey, number>>({ all: 0, learned: 0, review: 0, new: 0 });
  const prevFilterRef = useRef<FilterKey>(selectedFilter);

  // J/K の折り返し（先頭↔末尾）で遠くへスクロールする間、「移動中…」ピルを出して
  // 「フリーズではない・いずれ止まる」ことを伝える。目的カードが可視になったら閉じる。
  const [jumpPill, setJumpPill] = useState<null | 'top' | 'bottom'>(null);
  const jumpTargetIdRef = useRef<string | null>(null);
  const jumpShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearJumpTimers() {
    if (jumpShowTimerRef.current) { clearTimeout(jumpShowTimerRef.current); jumpShowTimerRef.current = null; }
    if (jumpSafetyTimerRef.current) { clearTimeout(jumpSafetyTimerRef.current); jumpSafetyTimerRef.current = null; }
  }
  function endJumpIndicator() {
    clearJumpTimers();
    jumpTargetIdRef.current = null;
    setJumpPill(null);
  }
  function startJumpIndicator(targetId: string, label: 'top' | 'bottom') {
    clearJumpTimers();
    jumpTargetIdRef.current = targetId;
    // 250ms 以内に到着したらピルを出さない（小さいデッキで一瞬光るのを防ぐ）
    jumpShowTimerRef.current = setTimeout(() => {
      if (jumpTargetIdRef.current === targetId) setJumpPill(label);
    }, 250);
    // 保険：万一 onViewableItemsChanged が来なくても 8 秒で閉じる
    jumpSafetyTimerRef.current = setTimeout(() => endJumpIndicator(), 8000);
  }
  // 現在画面に見えているカード ID の集合（ピルの要否判定に使う）。
  const viewableKeysRef = useRef<Set<string>>(new Set());
  // onViewableItemsChanged / viewabilityConfig は識別子が毎レンダー変わると RN が警告するため ref で固定。
  const onViewableItemsChangedRef = useRef(({ viewableItems }: { viewableItems: { key: string }[] }) => {
    viewableKeysRef.current = new Set(viewableItems.map((v) => v.key));
    const target = jumpTargetIdRef.current;
    if (target && viewableKeysRef.current.has(target)) endJumpIndicator();
  });
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 10 });
  useEffect(() => () => clearJumpTimers(), []);
  const listRef = useRef<FlatList<Card>>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const selectionModeRef = useRef(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const selectedCardIdsRef = useRef<Set<string>>(new Set());
  // 直近に複製で作成したカード ID。該当行に一時的な「NEW」バッジを出して
  // 元カードと見分けやすくする。画面に再フォーカスしたタイミングでクリアする。
  const [recentlyDuplicatedIds, setRecentlyDuplicatedIds] = useState<Set<string>>(new Set());
  const recentlyDuplicatedIdsRef = useRef<Set<string>>(new Set());
  const cardSortOrderRef = useRef(cardSortOrder);
  const manualSortLockedRef = useRef(manualSortLocked);
  const selectedFilterRef = useRef(selectedFilter);
  const imageBlockLabelRef = useRef('');
  const deckArchivedRef = useRef(false);
  const confirmDeleteCardRef = useRef<(card: Card) => void>(() => {});
  const archiveCardRef = useRef<(card: Card) => void>(() => {});
  const startStudyFromCardRef = useRef<(cardId: string) => void>(() => {});
  const [isProcessing, setIsProcessing] = useState(false);
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [infoModal, setInfoModal] = useState<{ title?: string; message: React.ReactNode } | null>(null);
  // 閉じる（infoModal=null）瞬間にフェード中の中身が空にならないよう、直前の内容を保持する。
  const lastInfoModalRef = useRef<{ title?: string; message: React.ReactNode } | null>(null);
  if (infoModal) lastInfoModalRef.current = infoModal;
  const [pendingMoveDeck, setPendingMoveDeck] = useState<Deck | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteModalMessage, setDeleteModalMessage] = useState('');
  const pendingDeleteActionRef = useRef<(() => Promise<void>) | null>(null);
  const focusedCardIdRef = useRef<string | null>(null);
  const [focusedCardId, setFocusedCardIdState] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descTruncatable, setDescTruncatable] = useState(false);
  const DECK_SHORTCUT_SECTIONS_NORMAL = [
    { titleKey: 'shortcut.catDisplay', items: [
      { key: '1–4', descKey: 'shortcut.switchFilter' },
      { key: 'M / ⇧M',    descKey: 'shortcut.cycleCardSort' },
      { key: '⌘L',        descKey: 'shortcut.toggleSortLock' },
      { key: 'S',         descKey: 'shortcut.toggleSelect' },
    ] },
    { titleKey: 'shortcut.catFocus', items: [
      { key: 'J / K',     descKey: 'shortcut.focusNextPrev' },
      { key: 'U / D',     descKey: 'shortcut.reorderUpDown' },
      { key: 'P',         descKey: 'shortcut.editFocusedItem' },
      { key: 'A',         descKey: 'shortcut.toggleCardStats', pro: true },
      { key: 'Delete',    descKey: 'shortcut.deleteFocused' },
    ] },
    { titleKey: 'shortcut.catNavigate', items: [
      { key: 'Space',     descKey: 'shortcut.startStudy' },
      { key: '⇧Space',    descKey: 'shortcut.startStudyFromFocus' },
      { key: 'N',         descKey: 'shortcut.new' },
      { key: 'B',         descKey: 'shortcut.back' },
    ] },
    { titleKey: 'shortcut.catOther', items: [
      { key: 'ESC',       descKey: 'shortcut.esc' },
      { key: '?',         descKey: 'shortcut.showShortcuts' },
    ] },
  ];
  const DECK_SHORTCUT_SECTIONS_SELECT = [
    { titleKey: 'shortcut.catDisplay', items: [
      { key: 'S',     descKey: 'shortcut.exitSelect' },
    ] },
    { titleKey: 'shortcut.catFocus', items: [
      { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
      { key: 'Space', descKey: 'shortcut.toggleCheck' },
      { key: 'A',     descKey: 'shortcut.selectAll' },
      { key: 'M',     descKey: 'shortcut.moveSelected' },
      { key: 'Delete', descKey: 'shortcut.deleteSelected' },
      { key: 'C',     descKey: 'shortcut.duplicateSelected' },
      { key: 'E',     descKey: 'shortcut.archiveSelected' },
    ] },
    { titleKey: 'shortcut.catOther', items: [
      { key: 'ESC',   descKey: 'shortcut.esc' },
      { key: '?',     descKey: 'shortcut.showShortcuts' },
    ] },
  ];
  const [filterCardIds, setFilterCardIds] = useState<Record<FilterKey, Set<string>>>({
    all: new Set(),
    learned: new Set(),
    review: new Set(),
    new: new Set(),
  });
  // filterCardIds は初期値が空 Set で、loadCards 完了まで非「すべて」フィルターは 0 枚に見える。
  // 「読み込み前の空」と「本当に 0 枚」を区別し、前者では学習開始ボタンを薄色化しない（遷移時のチラつき防止）。
  const [filtersReady, setFiltersReady] = useState(false);

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
    setFiltersReady(true);
  }, [db, id, setCards]);

  // 同期（ダウンロード）でローカルデータが入れ替わったら、フォーカス中でもカード一覧を再読込する。
  const dataRevision = useSyncStore((s) => s.dataRevision);
  useEffect(() => {
    if (dataRevision === 0) return;
    loadCards();
  }, [dataRevision, loadCards]);

  useFocusEffect(
    useCallback(() => {
      if (!deck) {
        router.back();
        return;
      }
      lastFocusTimeRef.current = Date.now();
      const targetOffset = savedScrollOffsetRef.current;
      setDescExpanded(false);
      pendingScrollToIdRef.current = null;
      // 別画面（カード編集）で複製した分は保留 ID として取り込み「NEW」表示し、
      // 複製先（A'）へフォーカスを移して A' までスクロールする（スクロール復元はしない）。
      // それ以外は戻ってきた時点でバッジを消し（複製直後の一時表示のみ）、スクロール位置を復元する。
      const pendingNew = takeDuplicated();
      // 新規作成から戻った場合の作成カード ID（複製と違い「NEW」バッジは出さず、フォーカス＋スクロールのみ）
      const pendingFocusCard = takePendingFocus('card');
      if (pendingNew.length > 0) {
        const lastId = pendingNew[pendingNew.length - 1];
        focusedCardIdRef.current = lastId;
        setFocusedCardIdState(lastId);
        pendingScrollToIdRef.current = lastId;
        restorationEndTimeRef.current = 0;
        setRecentlyDuplicatedIds(new Set(pendingNew));
      } else if (pendingFocusCard) {
        focusedCardIdRef.current = pendingFocusCard;
        setFocusedCardIdState(pendingFocusCard);
        pendingScrollToIdRef.current = pendingFocusCard;
        restorationEndTimeRef.current = 0;
        setRecentlyDuplicatedIds((prev) => (prev.size === 0 ? prev : new Set()));
      } else {
        restorationEndTimeRef.current = Date.now() + 800;
        setRecentlyDuplicatedIds((prev) => (prev.size === 0 ? prev : new Set()));
      }
      // 複製/新規作成で戻った場合の該当カードへのスクロールは専用 effect が担当するため復元しない。
      // ref ではなくローカル値で判定し、専用 effect の ref クリアと競合しないようにする。
      const skipRestore = pendingNew.length > 0 || !!pendingFocusCard;
      let cancelled = false;
      loadCards().then(() => {
        if (cancelled || skipRestore) return;
        setTimeout(() => {
          if (!cancelled) listRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
        }, 50);
      });
      // 前の画面でソフトキーボードが残留していた場合に確実に閉じる
      Keyboard.dismiss();
      return () => {
        cancelled = true;
        restorationEndTimeRef.current = 0;
        savedScrollOffsetRef.current = scrollOffsetRef.current;
      };
    }, [loadCards])
  );

  useEffect(() => {
    filterOffsetsRef.current[prevFilterRef.current] = scrollOffsetRef.current;
    prevFilterRef.current = selectedFilter;
    listRef.current?.scrollToOffset({ offset: filterOffsetsRef.current[selectedFilter] ?? 0, animated: false });
  }, [selectedFilter]);

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

  async function archiveCard(card: Card) {
    await setCardArchived(db, card.id, !card.archived);
    await loadCards();
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedCardIds(new Set());
    // カーソル（オレンジ枠）は通常モードのフォーカスへ引き継ぐ（消えた項目は ID 基準で自動的に null）
    setShowDeckPicker(false);
  }

  function enterSelectionMode() {
    setSelectionMode(true);
    // フォーカス中の項目はカーソル（オレンジ枠）として残すが、初期選択はしない。
    // （フォーカス項目以外を選びたいケースが多く、自動チェックは誤選択を生むため）
    setSelectedCardIds(new Set());
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
      const newIds: string[] = [];
      for (const cardId of ids) {
        const dup = await duplicateCard(db, cardId);
        newIds.push(dup.id);
      }
      if (deck) {
        updateDeck({ ...deck, cardCount: deck.cardCount + ids.length });
      }
      exitSelectionMode();
      // 複製したカードに一時的な「NEW」バッジを出す（再フォーカスでクリア）。
      // 同じ画面にいる間に複数回コピーした分は積み増して、すべて NEW のままにする。
      setRecentlyDuplicatedIds((prev) => new Set([...prev, ...newIds]));
      await loadCards();
      setInfoModal({ title: t('card.duplicate'), message: t('card.duplicateSuccess', { count: ids.length }) });
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
      const selCards = deckCards.filter((c) => selectedCardIds.has(c.id));
      const next = !(selCards.length > 0 && selCards.every((c) => c.archived));
      await setCardsArchived(db, ids, next);
      exitSelectionMode();
      await loadCards();
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

  const navigateToCardEdit = useCallback((cardId: string) => {
    router.push({ pathname: '/deck/[id]/card/[cardId]/edit', params: { id, cardId } });
  }, [router, id]);

  // CardRow に渡す安定コールバック（ref/stable setState 経由なので依存は最小）。
  const handleRowPress = useCallback((item: Card) => {
    focusedCardIdRef.current = item.id;
    setFocusedCardIdState(item.id);
    if (selectionModeRef.current) {
      // タグ画面と挙動を揃える：タップした項目へカーソル（オレンジ枠）も移動
      setSelectedCardIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
        return next;
      });
    } else {
      navigateToCardEdit(item.id);
    }
  }, [navigateToCardEdit]);
  const handleRowLongPress = useCallback((item: Card, drag: () => void) => {
    if (selectionModeRef.current) return;
    if (selectedFilterRef.current !== 'all') {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: t('card.reorderDisabledMessage') });
      return;
    }
    if (cardSortOrderRef.current !== 'manual') {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: t('card.reorderDisabledMessageSort') });
      return;
    }
    if (manualSortLockedRef.current) {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: t('card.reorderLockedMessage') });
      return;
    }
    drag();
  }, [t]);
  const handleStatsPress = useCallback((item: Card) => {
    focusedCardIdRef.current = item.id;
    setFocusedCardIdState(item.id);
    setStatsCardId(item.id);
  }, []);
  const handleEditPress = useCallback((item: Card) => {
    focusedCardIdRef.current = item.id;
    setFocusedCardIdState(item.id);
    navigateToCardEdit(item.id);
  }, [navigateToCardEdit]);
  const handleDeleteRow = useCallback((item: Card) => confirmDeleteCardRef.current(item), []);
  const handleArchiveRow = useCallback((item: Card) => archiveCardRef.current(item), []);
  const handleStudyFromHere = useCallback((item: Card) => startStudyFromCardRef.current(item.id), []);

  const renderItem = useCallback(({ item, drag }: RenderItemParams<Card>) => {
    const theme = themeRef.current;
    const isSelMode = selectionModeRef.current;
    // ScaleDecorator はドラッグ並べ替えが実際に効く「すべて＋手動」のときだけ使う。
    // 済み/復習/新規 では手動ソートでもドラッグ不可（onDragEnd で無効化）＝ScaleDecorator は不要で、
    // その animated ラッパーが横スワイプ（削除/アーカイブ）のジェスチャーを奪ってしまうため外す。
    // （DraggableFlatList 内でも ScaleDecorator 無しのセル描画は問題ない）
    // ロック中はドラッグ並べ替えを止め、素の FlatList にしてスワイプ（ここから学習/削除/アーカイブ）を効かせる。
    const inDraggable = cardSortOrderRef.current === 'manual' && selectedFilterRef.current === 'all' && !manualSortLockedRef.current;
    const row = (
      <CardRow
        item={item}
        drag={drag}
        isFocused={item.id === focusedCardIdRef.current}
        isSelected={selectedCardIdsRef.current.has(item.id)}
        isSelMode={isSelMode}
        isNew={recentlyDuplicatedIdsRef.current.has(item.id)}
        effectiveArchived={item.archived || deckArchivedRef.current}
        swipeEnabled={!isSelMode && !inDraggable}
        isPro={isPro}
        theme={theme}
        themeKey={`${theme.dark}:${theme.fontScale}:${theme.colors.background}`}
        imageLabel={imageBlockLabelRef.current}
        noTextLabel={t('card.noText')}
        onPress={handleRowPress}
        onLongPress={handleRowLongPress}
        onStats={handleStatsPress}
        onEdit={handleEditPress}
        onDelete={handleDeleteRow}
        onArchive={handleArchiveRow}
        onStudyFromHere={handleStudyFromHere}
      />
    );
    return inDraggable ? <ScaleDecorator>{row}</ScaleDecorator> : row;
  }, [isPro, t, handleRowPress, handleRowLongPress, handleStatsPress, handleEditPress, handleDeleteRow, handleArchiveRow, handleStudyFromHere]);

  // FlatList の再描画トリガー。毎レンダー新オブジェクトだと並べ替えのたびに全セルが
  // 再描画されちらつくため、選択状態・フォーカス・テーマが変わったときだけ identity を変える。
  // theme はオブジェクトで毎回 identity が変わるため、テーマ変化を表すプリミティブを deps にする。
  const listExtraData = useMemo(
    () => ({ selectionMode, selectedCardIds, focusedCardId, dark: theme.dark, fontScale: theme.fontScale, bg: theme.colors.background }),
    [selectionMode, selectedCardIds, focusedCardId, theme.dark, theme.fontScale, theme.colors.background],
  );

  const deckCards = useMemo(() => cards.filter((c) => c.deckId === id), [cards, id]);
  const filteredCards = useMemo(
    () => selectedFilter === 'all'
      ? deckCards
      : deckCards.filter((c) => filterCardIds[selectedFilter].has(c.id)),
    [deckCards, selectedFilter, filterCardIds],
  );
  const displayedCards = useMemo(
    () => cardSortOrder === 'newest'
      ? [...filteredCards].sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0) || b.sortOrder - a.sortOrder)
      : cardSortOrder === 'oldest'
      ? [...filteredCards].sort((a, b) => (a.createdAt > b.createdAt ? 1 : a.createdAt < b.createdAt ? -1 : 0) || a.sortOrder - b.sortOrder)
      : filteredCards,
    [filteredCards, cardSortOrder],
  );

  // 複製で戻ってきた直後、複製先（A'）が一覧に現れたらそこへスクロールする。
  useEffect(() => {
    const targetId = pendingScrollToIdRef.current;
    if (!targetId) return;
    const idx = displayedCards.findIndex((c) => c.id === targetId);
    if (idx === -1) return;
    pendingScrollToIdRef.current = null;
    setTimeout(() => listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: false }), 50);
  }, [displayedCards]);

  // 仮想化で未レンダリングのインデックスへの scrollToIndex は失敗するため、概算位置まで
  // スクロールしてから再試行する（複製先 A' が末尾など画面外にある場合に必要）。
  function handleScrollToIndexFailed(info: { index: number; averageItemLength: number }) {
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false });
    }, 100);
  }

  selectionModeRef.current = selectionMode;
  selectedCardIdsRef.current = selectedCardIds;
  recentlyDuplicatedIdsRef.current = recentlyDuplicatedIds;
  cardSortOrderRef.current = cardSortOrder;
  manualSortLockedRef.current = manualSortLocked;
  selectedFilterRef.current = selectedFilter;
  imageBlockLabelRef.current = t('card.imageBlock');
  // デッキ自体がアーカイブ済みなら配下カードも実質的に学習対象外なのでグレー表示する
  deckArchivedRef.current = !!deck?.archived;

  // 034: 隠し TextInput を撤去しネイティブキーコマンドへ。フック規約上 early return より前で呼ぶ
  // 必要があるため、ハンドラが参照する後方定義（startVisibleStudy・focusedCardIndex 等）は
  // クロージャ経由で参照する（実行時＝キー押下時には初期化済み）。
  // ガード: DeckPicker 表示中は全キー無効（旧実装は hidden input を blur して同等を実現）。
  //         CardStats 表示中は A のみ（閉じる）。それ以外は選択/通常モードで分岐。
  useKeyCommands([
    {
      input: ' ',
      handler: () => {
        if (showDeckPicker || statsCardId !== null) return;
        if (selectionMode) {
          if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
            const cardId = displayedCards[focusedCardIndex].id;
            setSelectedCardIds((prev) => {
              const next = new Set(prev);
              if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
              return next;
            });
          }
        } else {
          startVisibleStudy();
        }
      },
    },
    // ⇧Space = フォーカスカードから一覧末尾までを学習（フォーカス無しは通常開始にフォールバック）。
    {
      input: ' ',
      modifierFlags: KeyCommand.keyModifierShift,
      handler: () => {
        if (showDeckPicker || statsCardId !== null || selectionMode) return;
        if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
          startStudyFromCard(displayedCards[focusedCardIndex].id);
        } else {
          startVisibleStudy();
        }
      },
    },
    { input: 'j', handler: () => { if (showDeckPicker || statsCardId !== null) return; moveFocus('next'); } },
    { input: 'k', handler: () => { if (showDeckPicker || statsCardId !== null) return; moveFocus('prev'); } },
    // U/D: フォーカス中のカードを手動並べ替え（上へ/下へ）。手動ソート・「すべて」・非選択モード時のみ有効。
    { input: 'u', handler: () => { if (showDeckPicker || statsCardId !== null) return; moveCardOrder('up'); } },
    { input: 'd', handler: () => { if (showDeckPicker || statsCardId !== null) return; moveCardOrder('down'); } },
    {
      input: 'a',
      handler: () => {
        if (showDeckPicker) return;
        if (statsCardId !== null) { setStatsCardId(null); return; }
        if (selectionMode) { toggleSelectAll(); return; }
        if (!isPro) return;
        if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
          setStatsCardId(displayedCards[focusedCardIndex].id);
        }
      },
    },
    // ⌘A = 全選択（選択モードのみ・OS 慣習のエイリアス）
    { input: 'a', modifierFlags: KeyCommand.keyModifierCommand, handler: () => { if (showDeckPicker || statsCardId !== null) return; if (selectionMode) toggleSelectAll(); } },
    {
      input: 'm',
      handler: () => {
        if (showDeckPicker || statsCardId !== null) return;
        if (selectionMode) {
          if (selectedCardIds.size > 0 && !isProcessing) setShowDeckPicker(true);
        } else if (selectedFilter === 'all') {
          const orders: CardSortOrder[] = ['manual', 'newest', 'oldest'];
          setCardSortOrder(orders[(orders.indexOf(cardSortOrder) + 1) % 3]);
        }
      },
    },
    // ⇧M = ソート逆順（通常モード・「すべて」フィルター時のみ。選択モードでは無効）。
    {
      input: 'm',
      modifierFlags: KeyCommand.keyModifierShift,
      handler: () => {
        if (showDeckPicker || statsCardId !== null || selectionMode) return;
        if (selectedFilter === 'all') {
          const orders: CardSortOrder[] = ['manual', 'newest', 'oldest'];
          setCardSortOrder(orders[(orders.indexOf(cardSortOrder) - 1 + 3) % 3]);
        }
      },
    },
    // ⌘L = ドラッグ並べ替えロックの切替（通常モード・手動ソート＋「すべて」フィルター時のみ）。
    // L 単独はフィルター切替のため修飾必須。ロックボタンの表示条件と一致させる。
    {
      input: 'l',
      modifierFlags: KeyCommand.keyModifierCommand,
      handler: () => {
        if (showDeckPicker || statsCardId !== null || selectionMode) return;
        if (selectedFilter === 'all' && cardSortOrder === 'manual') setManualSortLocked(!manualSortLocked);
      },
    },
    ...deleteKeySpecs(() => {
      if (showDeckPicker || statsCardId !== null) return;
      if (selectionMode) {
        if (selectedCardIds.size > 0 && !isProcessing) handleDeleteSelected();
      } else if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
        confirmDeleteCard(displayedCards[focusedCardIndex]);
      }
    }),
    {
      input: 's',
      handler: () => {
        if (showDeckPicker || statsCardId !== null) return;
        if (selectionMode) {
          exitSelectionMode();
        } else {
          enterSelectionMode();
        }
      },
    },
    { input: 'c', handler: () => { if (showDeckPicker || statsCardId !== null) return; if (selectionMode && selectedCardIds.size > 0 && !isProcessing) handleDuplicate(); } },
    // ⌘C = 複製（選択モードのみ・OS 慣習のエイリアス）
    { input: 'c', modifierFlags: KeyCommand.keyModifierCommand, handler: () => { if (showDeckPicker || statsCardId !== null) return; if (selectionMode && selectedCardIds.size > 0 && !isProcessing) handleDuplicate(); } },
    { input: 'e', handler: () => { if (showDeckPicker || statsCardId !== null) return; if (selectionMode && selectedCardIds.size > 0 && !isProcessing) handleArchiveSelected(); } },
    {
      input: 'p',
      handler: () => {
        if (showDeckPicker || statsCardId !== null || selectionMode) return;
        if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
          navigateToCardEdit(displayedCards[focusedCardIndex].id);
        }
      },
    },
    { input: 'b', handler: () => { if (showDeckPicker || statsCardId !== null || selectionMode) return; router.back(); } },
    { input: 'n', handler: () => { if (showDeckPicker || statsCardId !== null || selectionMode) return; router.push({ pathname: '/deck/[id]/card/new', params: { id } }); } },
    { input: '1', handler: () => { if (showDeckPicker || statsCardId !== null || selectionMode) return; const f = FILTER_KEY_MAP['1']; setSelectedFilter(f); if (initialFilterPreference === 'none') setLastDeckDetailFilter(f); } },
    { input: '2', handler: () => { if (showDeckPicker || statsCardId !== null || selectionMode) return; const f = FILTER_KEY_MAP['2']; setSelectedFilter(f); if (initialFilterPreference === 'none') setLastDeckDetailFilter(f); } },
    { input: '3', handler: () => { if (showDeckPicker || statsCardId !== null || selectionMode) return; const f = FILTER_KEY_MAP['3']; setSelectedFilter(f); if (initialFilterPreference === 'none') setLastDeckDetailFilter(f); } },
    { input: '4', handler: () => { if (showDeckPicker || statsCardId !== null || selectionMode) return; const f = FILTER_KEY_MAP['4']; setSelectedFilter(f); if (initialFilterPreference === 'none') setLastDeckDetailFilter(f); } },
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (showDeckPicker || statsCardId !== null || selectionMode) return;
        if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
          navigateToCardEdit(displayedCards[focusedCardIndex].id);
        }
      },
    },
    // ←/→・,/.・H/L = フィルター切替（タブ画面と統一）
    { input: ',', handler: () => cycleCardFilter('prev') },
    { input: '.', handler: () => cycleCardFilter('next') },
    { input: 'h', handler: () => cycleCardFilter('prev') },
    { input: 'l', handler: () => cycleCardFilter('next') },
    // 矢印キー: 上下=K/J（フォーカス移動）、左右=,/.（フィルター切替）
    { input: KeyCommand.keyInputUpArrow, handler: () => { if (showDeckPicker || statsCardId !== null) return; moveFocus('prev'); } },
    { input: KeyCommand.keyInputDownArrow, handler: () => { if (showDeckPicker || statsCardId !== null) return; moveFocus('next'); } },
    { input: KeyCommand.keyInputLeftArrow, handler: () => cycleCardFilter('prev') },
    { input: KeyCommand.keyInputRightArrow, handler: () => cycleCardFilter('next') },
    // ?（Shift+/）= ショートカット一覧を開く（閉じる/トグルは ShortcutsModal 側が担当）
    { input: '/', modifierFlags: KeyCommand.keyModifierShift, handler: () => { if (statsCardId !== null) return; setShowShortcutsModal((v) => !v); } },
  // 削除確認/移動確認/情報/ショートカット/デッキ選択 表示中は背景ナビを解除（統計シートは A トグルのため
  // 除外＝各ナビは statsCardId を個別ガード済み）。Esc は別フックで常時有効。
  ], !showDeckPicker && !showDeleteModal && !pendingMoveDeck && !infoModal && !showShortcutsModal);

  // ESC は常時有効：デッキ選択はピッカー側へ委譲、以降オーバーレイ → 選択モード解除 → 戻る。削除系は Return 非割当。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (showDeckPicker) return; // DeckPickerModal 側の Esc が閉じる
        if (statsCardId !== null) { setStatsCardId(null); return; }
        if (showDeleteModal) { setShowDeleteModal(false); return; }
        if (pendingMoveDeck) { setPendingMoveDeck(null); return; }
        if (infoModal) { setInfoModal(null); return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
        if (selectionMode) { exitSelectionMode(); return; }
        router.back();
      },
    },
  ]);

  // 「OK のみ」アラート（情報/ショートカット一覧/移動確認）は Return=OK。表示中のみ有効（main は解除済み）。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (infoModal) { setInfoModal(null); return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
        if (pendingMoveDeck) { doMove(); return; }
      },
    },
  ], Boolean(infoModal) || showShortcutsModal || Boolean(pendingMoveDeck));

  if (!deck) return null;

  confirmDeleteCardRef.current = confirmDeleteCard;
  archiveCardRef.current = archiveCard;

  const selectedCardsList = deckCards.filter((c) => selectedCardIds.has(c.id));
  const allSelectedArchived = selectedCardsList.length > 0 && selectedCardsList.every((c) => c.archived);

  // 学習開始：画面に見えている並び順（フィルタ済み・ソート済み）そのままで学習する。
  // セッション側で並びを再計算すると createdAt 同値の tie-break 差で見た目とズレるため、
  // 表示中のカード ID 列を明示的に渡して順序を厳守させる。アーカイブ済み（カード自身 or
  // デッキ）は学習対象外なので除外する。
  const startVisibleStudy = () => {
    const cardIds = displayedCards
      .filter((c) => !c.archived && !deck.archived)
      .map((c) => c.id);
    if (cardIds.length === 0) return;
    // 巨大IDをURLパラメータに載せると（数万枚デッキで）ルート状態のシリアライズに
    // 数秒かかるため、ストア経由で渡し params は order フラグだけにする。
    setStudyCardIds(cardIds);
    router.push({ pathname: '/study/session', params: { deckId: id, order: '1' } });
  };

  // フォーカス/右スワイプの「ここから学習」：指定カードから一覧末尾までを、一覧順で学習する
  // （startVisibleStudy の部分集合＝先頭を startId に切り詰めただけ）。アーカイブは同様に除外。
  const startStudyFromCard = (startId: string) => {
    const startIdx = displayedCards.findIndex((c) => c.id === startId);
    if (startIdx === -1) return;
    const cardIds = displayedCards
      .slice(startIdx)
      .filter((c) => !c.archived && !deck.archived)
      .map((c) => c.id);
    if (cardIds.length === 0) return;
    setStudyCardIds(cardIds);
    router.push({ pathname: '/study/session', params: { deckId: id, order: '1' } });
  };
  startStudyFromCardRef.current = startStudyFromCard;

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
    // 新しい移動が来たら、進行中の「移動中」ピルはいったん解除（目的地が変わるため）。
    if (jumpTargetIdRef.current) endJumpIndicator();
    const currentId = focusedCardIdRef.current;
    const currentIdx = currentId != null ? displayedCards.findIndex(c => c.id === currentId) : null;
    const ci = currentIdx === -1 ? null : currentIdx;
    const next = direction === 'next'
      ? (ci === null ? 0 : ci === displayedCards.length - 1 ? null : ci + 1)
      : (ci === null ? displayedCards.length - 1 : ci === 0 ? null : ci - 1);
    const newId = next != null && displayedCards[next] ? displayedCards[next].id : null;
    focusedCardIdRef.current = newId;
    setFocusedCardIdState(newId);
    if (next !== null) {
      // ヌルサイクルの折り返し（ci===null → 先頭/末尾へ）は遠くまでスクロールしうるので「移動中」ピルを出す。
      // ただし目的カードが既に画面に見えている場合はスクロールが動かず onViewableItemsChanged も
      // 発火しない（＝閉じられない）ので、最初から出さない。目的カードが可視になったら同ハンドラが閉じる。
      if (ci === null && newId && !viewableKeysRef.current.has(newId)) startJumpIndicator(newId, next === 0 ? 'top' : 'bottom');
      listRef.current?.scrollToIndex({ index: next, animated: true, viewPosition: 0.5 });
    }
  }

  // キーボードでの手動並べ替え（U=上へ / D=下へ）。手動ソート・「すべて」フィルター・非選択モード時のみ
  // 実際に動く（ドラッグの有効条件と同じ）。並べ替え不可の状態で押したときは、タップ（長押し）と
  // 同じ案内アラートを出す。フォーカスは ID 追跡で自動追従。
  function moveCardOrder(dir: 'up' | 'down') {
    if (selectionMode) return; // 選択モードでは U/D は並べ替えではない
    // 並べ替えできない状態＝長押しドラッグと同じ案内を出す（分岐順もタップと揃える）。
    if (selectedFilter !== 'all') {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: t('card.reorderDisabledMessage') });
      return;
    }
    if (cardSortOrder !== 'manual') {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: t('card.reorderDisabledMessageSort') });
      return;
    }
    if (manualSortLocked) {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: t('card.reorderLockedMessage') });
      return;
    }
    if (focusedCardIndex === null) return;
    const to = dir === 'up' ? focusedCardIndex - 1 : focusedCardIndex + 1;
    if (to < 0 || to >= displayedCards.length) return;
    const newOrder = [...displayedCards];
    const [moved] = newOrder.splice(focusedCardIndex, 1);
    newOrder.splice(to, 0, moved);
    reorderCards(newOrder);
    updateCardSortOrders(db, newOrder.map((c) => c.id));
    setTimeout(() => listRef.current?.scrollToIndex({ index: to, viewPosition: 0.5, animated: true }), 50);
  }

  // ←/→・,/.・H/L でフィルター（すべて/学習済み/復習/新規）を循環切替（タブ画面と同じ操作軸）。
  function cycleCardFilter(dir: 'prev' | 'next') {
    if (showDeckPicker || statsCardId !== null || selectionModeRef.current) return;
    const order: FilterKey[] = ['all', 'learned', 'review', 'new'];
    const i = order.indexOf(selectedFilterRef.current);
    const f = order[((i < 0 ? 0 : i) + (dir === 'next' ? 1 : -1) + order.length) % order.length];
    setSelectedFilter(f);
    if (initialFilterPreference === 'none') setLastDeckDetailFilter(f);
  }

  function toggleSelectAll() {
    if (selectedCardIds.size === displayedCards.length) {
      setSelectedCardIds(new Set());
    } else {
      setSelectedCardIds(new Set(displayedCards.map((c) => c.id)));
    }
  }

  const filterItems: { key: FilterKey; count: number | null; color: string; label: string }[] = [
    { key: 'all', count: deck.cardCount, color: theme.colors.primary, label: t('common.all') },
    { key: 'learned', count: todayReviewed, color: FILTER_COLORS.learned, label: t('common.learned') },
    { key: 'review', count: dueCount, color: FILTER_COLORS.due, label: t('common.due') },
    { key: 'new', count: unlearnedCount, color: theme.colors.textSecondary, label: t('common.new') },
  ];

  const filterItemMaxDigits = Math.max(...filterItems.map(f => f.count != null ? String(f.count).length : 1));
  const filterValueFontSize = fontSizeForDigits(theme, (Platform as any).isPad ? 1 : filterItemMaxDigits);
  const filterBlockMinHeight = 32 + Math.ceil(fontSizeForDigits(theme, 1) * 1.35) + 2 + Math.ceil(theme.fontSize.xs * 1.35);

  const cardSortDesc = cardSortOrder === 'newest' ? t('card.sortDescNewest')
    : cardSortOrder === 'oldest' ? t('card.sortDescOldest')
    : manualSortLocked ? t('card.sortDescManualLocked')
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
      <Stack.Screen options={{ headerShown: false }} />

      {/* インラインカスタムヘッダー */}
      <View style={{ height: lockedTopInset + 44, backgroundColor: theme.colors.surface }}>
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
            {!selectionMode && deck?.iconName && (
              <Ionicons
                name={deck.iconName as any}
                size={20}
                color={resolveDeckIconColors(deck.colorHex, theme).color}
              />
            )}
            <Text
              style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text, maxWidth: screenWidth * 0.46, flexShrink: 1 }}
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {selectionMode ? t('shortcut.selectMode') : (deck?.name ?? '')}
            </Text>
            {keyboardShortcutsEnabled && (
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
                enterSelectionMode();
              }
            }}
            disabled={!selectionMode && displayedCards.length === 0}
            style={[{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, !selectionMode && displayedCards.length === 0 && { opacity: 0.3 }]}
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
                  { backgroundColor: theme.colors.surface, minHeight: filterBlockMinHeight },
                  isSelected && { margin: 0, borderWidth: 2, borderColor: color },
                  selectionMode && { opacity: 0.5 },
                ]}
                onPress={() => {
                  if (selectionMode) return;
                  setSelectedFilter(key);
                  if (initialFilterPreference === 'none') setLastDeckDetailFilter(key);
                }}
              >
                <Text numberOfLines={1} allowFontScaling={false} style={[styles.statValue, { color, fontSize: filterValueFontSize }]}>{count ?? '—'}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.studyBtn, { backgroundColor: theme.colors.primary }, (selectionMode || (filtersReady && displayedCards.length === 0)) && { opacity: 0.5 }]}
          activeOpacity={0.8}
          disabled={selectionMode || displayedCards.length === 0}
          onPress={startVisibleStudy}
        >
          <Ionicons name="play" size={20} color="#FFF" />
          <Text style={[styles.studyBtnText, { fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('deck.study')}</Text>
        </TouchableOpacity>

        <Pressable style={styles.sectionTitleRow} onPress={() => { if (!selectionMode) setFocusedCardIndex(null); }}>
          <View style={styles.sectionTitleLeft}>
            {selectionMode ? (
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('card.selectHint')}
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {t('card.list')}
                </Text>
                <Pressable
                  onPress={() => setInfoModal({ title: t('card.list'), message: <InfoContent text={t('card.listInfoMessage')} /> })}
                  hitSlop={8}
                  accessibilityLabel={t('card.listInfoLabel')}
                >
                  <Ionicons name="information-circle-outline" size={Math.max(theme.fontSize.lg, 20)} color={theme.colors.textTertiary} />
                </Pressable>
              </View>
            )}
            {!selectionMode && (
              <Text style={[styles.filterDesc, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {filterDescMap[selectedFilter]}
              </Text>
            )}
          </View>
          {selectedFilter === 'all' && !selectionMode && (
            <View style={styles.sortButtons}>
              {/* 手動ソート時のみ表示：ドラッグ並べ替えロック（ON=固定してスワイプ可）。左端・枠なしアイコンのみ。 */}
              {cardSortOrder === 'manual' && (
                <Pressable
                  style={{ justifyContent: 'center', alignItems: 'center', paddingVertical: 7, paddingHorizontal: (Platform as any).isPad ? 12 : 6 }}
                  hitSlop={8}
                  onPress={() => setManualSortLocked(!manualSortLocked)}
                >
                  <Ionicons
                    name={manualSortLocked ? 'lock-closed' : 'lock-open-outline'}
                    size={(Platform as any).isPad ? Math.max(theme.fontSize.lg, 20) : Math.max(theme.fontSize.lg, 18)}
                    color={manualSortLocked ? theme.colors.primary : theme.colors.textSecondary}
                  />
                </Pressable>
              )}
              {CARD_SORT_OPTIONS.map(({ key, icon }) => {
                const active = cardSortOrder === key;
                return (
                  <Pressable
                    key={key}
                    style={[
                      styles.sortBtn,
                      { borderColor: active ? theme.colors.primary : themedFrameBorder(theme), paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
                      active && { backgroundColor: theme.colors.primary },
                    ]}
                    onPress={() => setCardSortOrder(key)}
                  >
                    <Ionicons name={icon} size={(Platform as any).isPad ? Math.max(theme.fontSize.lg, 20) : Math.max(theme.fontSize.lg, 18)} color={active ? '#FFF' : theme.colors.textSecondary} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </Pressable>

      </View>

      <Pressable style={{ flex: 1 }} onPress={() => { if (!selectionMode) setFocusedCardIndex(null); }}>
        {/* DraggableFlatList は「ドラッグ並べ替えが実際に効く＝すべて＋手動」のときだけ使う。
            それ以外（新しい/古い順、または手動でも 済み/復習/新規 フィルター）は素の FlatList。
            理由: DraggableFlatList はセルのジェスチャー処理が横スワイプ（削除/アーカイブ）を奪うため、
            ドラッグ不可の画面では素の FlatList にしてスワイプを効かせる。all↔他フィルターの切替で
            list 種別が変わり再マウントするが、手動ソート時に限られるため許容。 */}
        {cardSortOrder === 'manual' && selectedFilter === 'all' && !manualSortLocked ? (
          <DraggableFlatList
            ref={listRef as any}
            // 外側コンテナを flex:1 でビューポート高さに制約する。これが無いと containerSize が
            // コンテンツ全体高さになり、下方向 autoscroll の移動先 min(.., scrollViewSize-containerSize)
            // が 0 に潰れて下方向にスクロールできない（上方向は containerSize 非依存なので動く）。
            containerStyle={{ flex: 1 }}
            data={displayedCards}
            keyExtractor={(item) => item.id}
            // autoscroll をゆっくりにして細かい位置調整を可能にする（パッチで animated:false
            // にしているため既定値だと一気にスクロールしてしまう）。要調整の数値。
            // ※速度はリリースビルド（TestFlight）基準で調整すること。dev（expo start）は JS スレッドが
            //   遅くカクつき・体感速度が変わるため判断材料にしない。リリースで速すぎたため 10→6 に。
            autoscrollSpeed={6}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            automaticallyAdjustsScrollIndicatorInsets={false}
            scrollsToTop={false}
            // ドラッグ autoscroll でセルが空白になりやすいので広めに描画する。
            windowSize={21}
            onScrollOffsetChange={(offset) => {
              scrollOffsetRef.current = offset;
              if (
                Date.now() < restorationEndTimeRef.current &&
                savedScrollOffsetRef.current > 50 &&
                offset < savedScrollOffsetRef.current - 30
              ) {
                listRef.current?.scrollToOffset({ offset: savedScrollOffsetRef.current, animated: false });
              }
            }}
            onScrollBeginDrag={() => { restorationEndTimeRef.current = 0; }}
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
            onScrollToIndexFailed={handleScrollToIndexFailed}
            onDragEnd={({ data }) => {
              if (selectionMode) return;
              if (selectedFilter !== 'all' || cardSortOrder !== 'manual') return;
              reorderCards(data);
              updateCardSortOrders(db, data.map((c) => c.id));
            }}
            renderItem={renderItem}
            extraData={listExtraData}
            onViewableItemsChanged={onViewableItemsChangedRef.current}
            viewabilityConfig={viewabilityConfigRef.current}
          />
        ) : (
          <FlatList
            ref={listRef}
            style={{ flex: 1 }}
            data={displayedCards}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            automaticallyAdjustsScrollIndicatorInsets={false}
            scrollsToTop={false}
            // ドラッグしないので保持セルを減らし、並びが変わる切替を軽くする。
            windowSize={9}
            scrollEventThrottle={16}
            onScroll={(e) => {
              const offset = e.nativeEvent.contentOffset.y;
              scrollOffsetRef.current = offset;
              if (
                Date.now() < restorationEndTimeRef.current &&
                savedScrollOffsetRef.current > 50 &&
                offset < savedScrollOffsetRef.current - 30
              ) {
                listRef.current?.scrollToOffset({ offset: savedScrollOffsetRef.current, animated: false });
              }
            }}
            onScrollBeginDrag={() => { restorationEndTimeRef.current = 0; }}
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
            onScrollToIndexFailed={handleScrollToIndexFailed}
            renderItem={({ item }) => renderItem({ item, drag: () => {} } as RenderItemParams<Card>)}
            extraData={listExtraData}
            onViewableItemsChanged={onViewableItemsChangedRef.current}
            viewabilityConfig={viewabilityConfigRef.current}
          />
        )}
      </Pressable>

      {jumpPill && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={[styles.jumpPill, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {jumpPill === 'bottom' ? t('card.jumpingToBottom') : t('card.jumpingToTop')}
            </Text>
          </View>
        </View>
      )}

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
              style={[styles.iconBtn, { backgroundColor: theme.colors.primary }, (selectedCardIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={() => { if (!isProcessing) setShowDeckPicker(true); }}
              disabled={selectedCardIds.size === 0 || isProcessing}
            >
              <Ionicons name="arrow-forward-circle-outline" size={22} color="#FFF" />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: theme.colors.primary }, (selectedCardIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={handleArchiveSelected}
              disabled={selectedCardIds.size === 0 || isProcessing}
              accessibilityLabel={allSelectedArchived ? t('common.unarchive') : t('common.archive')}
            >
              <Ionicons name={allSelectedArchived ? 'archive' : 'archive-outline'} size={22} color="#FFF" />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: '#C62828' }, (selectedCardIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={handleDeleteSelected}
              disabled={selectedCardIds.size === 0 || isProcessing}
            >
              <Ionicons name="trash-outline" size={22} color="#FFF" />
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

      <CardStatsSheet cardId={statsCardId} onClose={() => setStatsCardId(null)} />
      <DeckPickerModal
        visible={showDeckPicker}
        title={t('card.selectDeckTitle')}
        decks={decks.filter((d) => d.id !== id)}
        onSelect={handleMoveToDeck}
        onClose={() => setShowDeckPicker(false)}
        showCardCount
        onCreateDeck={async (name) => {
          const deck = await createDeck(db, { name, description: '', language: 'ja' });
          addDeck(deck);
          return deck;
        }}
      />
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        maxHeight="75%"
        subtitle={selectionMode ? t('shortcut.selectMode') : t('shortcut.normalMode')}
        sections={(selectionMode ? DECK_SHORTCUT_SECTIONS_SELECT : DECK_SHORTCUT_SECTIONS_NORMAL)
          .map((s) => ({ title: t(s.titleKey), items: s.items }))
        }
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={deleteModalMessage}
        onConfirm={handleDeleteConfirm}
        onClose={() => setShowDeleteModal(false)}
      />
      <InfoModal
        visible={!!infoModal}
        title={lastInfoModalRef.current?.title}
        message={lastInfoModalRef.current?.message ?? ''}
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
    justifyContent: 'center',
    margin: 2,
    ...SHADOW.card,
  },
  statValue: { fontWeight: '700' },
  statLabel: { marginTop: 2, textAlign: 'center', fontWeight: '600' },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...SHADOW.subtle,
  },
  // カードの外側マージンは SwipeToDeleteRow のコンテナへ（スワイプ領域に余白を含めない）
  cardRowSpacing: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  cardPreview: { flex: 1 },
  jumpPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    ...SHADOW.subtle,
  },
  newBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  newBadgeText: { fontWeight: '700' },
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
