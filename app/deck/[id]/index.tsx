import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeScrollsToTop } from '@/lib/useSafeScrollsToTop';
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
import { ArchivePill, useArchivePill } from '@/components/ArchivePill';
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
import { useLockedHeaderHeights } from '@/lib/useLockedTopInset';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { createDeck, setDeckArchived } from '@/lib/database/decks';
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
  /** 038: 選択モードのまとめ移動ドラッグ中（isActive）に出す「×N」バッジの枚数。非表示は null。 */
  bulkDragCount: number | null;
  effectiveArchived: boolean;
  /** 右スワイプ「ここから学習」を出すか（アーカイブ済みカード＝学習対象外の行では出さない）。 */
  canStudyFromHere: boolean;
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
    item, drag, isFocused, isSelected, isSelMode, isNew, bulkDragCount, effectiveArchived, canStudyFromHere, swipeEnabled,
    isPro, theme, imageLabel, noTextLabel, onPress, onLongPress, onStats, onEdit, onDelete, onArchive, onStudyFromHere,
  } = props;
  const preview = getCardPreview(item.frontContent, imageLabel);
  return (
    <SwipeToDeleteRow
      enabled={swipeEnabled}
      onDelete={() => onDelete(item)}
      onArchive={() => onArchive(item)}
      // 右スワイプ「ここから学習」。選択モードでは出さない（swipeEnabled が false なので実質不要だが明示）。
      // アーカイブ済みカードでも出さない（学習対象外＝押しても次のカードから始まってしまうため）。
      onStudyFromHere={isSelMode || !canStudyFromHere ? undefined : () => onStudyFromHere(item)}
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
        {/* 038: まとめ移動ドラッグ中の「×N」バッジ（NEW バッジと同スタイル） */}
        {bulkDragCount != null && (
          <View style={[styles.newBadge, { backgroundColor: theme.colors.primary }]}>
            <Text allowFontScaling={false} style={[styles.newBadgeText, { color: theme.colors.primaryText, fontSize: theme.fontSize.xs }]}>{`×${bulkDragCount}`}</Text>
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
  prev.bulkDragCount === next.bulkDragCount &&
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
  // 標準ヘッダーと同じ高さ算出（Dynamic Island 補正込み）。lib/useLockedTopInset.ts 参照。
  const headerHeights = useLockedHeaderHeights();
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
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>(() => {
    // アーカイブ済みデッキは activeCardCond（カード＋所属デッキとも非アーカイブ）により
    // 「学習済み/復習/新規」が構造的に常に 0 件になる。中身が存在し得ないフィルターで開いても
    // 空リスト＋学習ボタン無効（＝2択ダイアログにも到達できない）になるだけなので、
    // 初期表示だけ「すべて」に倒す。設定値そのもの（通常デッキ向けの指定）は書き換えない。
    if (decks.find((d) => d.id === id)?.archived) return 'all';
    return preferenceToFilter(initialFilterPreference) ?? lastDeckDetailFilter;
  });
  // ステータスバータップで先頭へ（iOS標準 scrollsToTop）。フォーカス中の画面だけ有効にする
  // （有効候補が複数あると iOS が機能を無効化するため）。さらに iPadOS 26 はポップ遷移終了時に
  // scrollsToTop を誤発火させる（下へスクロールした状態で push 画面から戻ると一瞬ちらつく）ため、
  // フォーカス直後 800ms も無効のままにする（詳細は lib/useSafeScrollsToTop.ts）。
  const scrollsToTopArmed = useSafeScrollsToTop();
  const lastFocusTimeRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const savedScrollOffsetRef = useRef(0);
  const restorationEndTimeRef = useRef(0);
  // 複製で戻ってきた直後にスクロールしたい複製先（A'）の ID。一覧に現れ次第そこへスクロールする。
  const pendingScrollToIdRef = useRef<string | null>(null);

  // K の折り返し（先頭→末尾）で遠くへスクロールする間、「末尾へ移動中…」ピルを出して
  // 「フリーズではない・いずれ止まる」ことを伝える。目的カードが可視になったら閉じる。
  // 末尾への折り返し限定：仮想化の逐次描画で時間がかかるのは「遠い未レンダリングの末尾」へ
  // 向かうときだけで、先頭へはオフセット0が正確に分かるため常に一瞬＝ピル不要
  // （出すとスクロールアニメーション中に一瞬ちらつくだけの害になる）。
  const [jumpPill, setJumpPill] = useState(false);
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
    setJumpPill(false);
  }
  function startJumpIndicator(targetId: string) {
    clearJumpTimers();
    jumpTargetIdRef.current = targetId;
    // 250ms 以内に到着したらピルを出さない（小さいデッキで一瞬光るのを防ぐ）
    jumpShowTimerRef.current = setTimeout(() => {
      if (jumpTargetIdRef.current === targetId) setJumpPill(true);
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
  // アーカイブ中デッキで学習を開始しようとしたときの2択ダイアログ（startId=「ここから学習」の起点）
  const [archivedStudyPrompt, setArchivedStudyPrompt] = useState<{ startId: string | null } | null>(null);
  const promptHasUnarchiveRef = useRef(false);
  const pendingDeleteActionRef = useRef<(() => Promise<void>) | null>(null);
  const focusedCardIdRef = useRef<string | null>(null);
  const [focusedCardId, setFocusedCardIdState] = useState<string | null>(null);
  const { archivePill, showArchivePill } = useArchivePill();
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
      { key: 'E',         descKey: 'shortcut.archiveFocused' },
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
      { key: 'U / D', descKey: 'shortcut.reorderSelectedUpDown' },
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
    // 操作した行にフォーカスを移す（行タップ/編集ボタンと同じ流儀。スワイプだけ例外にしない）。
    // 「すべて」以外のフィルターではアーカイブすると行が消えるが、focusedCardId は保持され、
    // 「すべて」に戻せば青枠が復活する（focusedCardIndex は displayedCards から毎回導出するため）。
    // フォーカスまでに留めること：ここから scrollToIndex で追いかけると「遠いオフセットへの
    // 一足飛び」になり、500枚級・可変高セルでは未測定領域の実測置換でリストが上下に揺れ続ける
    // （手動スクロールでは順に測定されるので起きない）。実装して revert 済み・再試行禁止。
    focusedCardIdRef.current = card.id;
    setFocusedCardIdState(card.id);
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

  // 選択トグル（タップ / Space 共通）
  const toggleCardSelected = useCallback((cardId: string) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
      return next;
    });
  }, []);

  // CardRow に渡す安定コールバック（ref/stable setState 経由なので依存は最小）。
  const handleRowPress = useCallback((item: Card) => {
    focusedCardIdRef.current = item.id;
    setFocusedCardIdState(item.id);
    if (selectionModeRef.current) {
      // タグ画面と挙動を揃える：タップした項目へカーソル（オレンジ枠）も移動
      toggleCardSelected(item.id);
    } else {
      navigateToCardEdit(item.id);
    }
  }, [navigateToCardEdit, toggleCardSelected]);
  const handleRowLongPress = useCallback((item: Card, drag: () => void) => {
    // 並べ替え不可の案内は通常/選択モード共通（U/D キーと同じ3分岐）。
    if (selectedFilterRef.current !== 'all') {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: <InfoContent text={t('card.reorderDisabledMessage')} /> });
      return;
    }
    if (cardSortOrderRef.current !== 'manual') {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: <InfoContent text={t('card.reorderDisabledMessageSort')} /> });
      return;
    }
    if (manualSortLockedRef.current) {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: <InfoContent text={t('card.reorderLockedMessage')} /> });
      return;
    }
    // 038 Phase3: 選択モードは「選択中カードの長押し」だけまとめ移動のドラッグを開始
    // （ドロップ時展開方式＝ドラッグ中のデータ変更なし。展開は onDragEnd が行う）。
    // 未選択カードの長押しは何もしない。
    if (selectionModeRef.current && !selectedCardIdsRef.current.has(item.id)) return;
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

  const renderItem = useCallback(({ item, drag, isActive }: RenderItemParams<Card>) => {
    const theme = themeRef.current;
    const isSelMode = selectionModeRef.current;
    // 038: 選択モードのまとめ移動ドラッグ中は、ドラッグ行に「×N」バッジを出す（2枚以上のとき）。
    const selCount = selectedCardIdsRef.current.size;
    const bulkDragCount =
      isActive && isSelMode && selCount > 1 && selectedCardIdsRef.current.has(item.id) ? selCount : null;
    // ScaleDecorator はドラッグ並べ替えが実際に効く「すべて＋手動」のときだけ使う。
    // 済み/復習/新規 では手動ソートでもドラッグ不可（onDragEnd で無効化）＝ScaleDecorator は不要で、
    // その animated ラッパーが横スワイプ（削除/アーカイブ）のジェスチャーを奪ってしまうため外す。
    // （DraggableFlatList 内でも ScaleDecorator 無しのセル描画は問題ない）
    // ロック中はドラッグ並べ替えを止め、素の FlatList にしてスワイプ（ここから学習/削除/アーカイブ）を効かせる。
    // ※リスト種別の分岐と同じ deferred 由来の値（listIsDraggableRef）を参照する。
    const inDraggable = listIsDraggableRef.current;
    const row = (
      <CardRow
        item={item}
        drag={drag}
        isFocused={item.id === focusedCardIdRef.current}
        isSelected={selectedCardIdsRef.current.has(item.id)}
        isSelMode={isSelMode}
        isNew={recentlyDuplicatedIdsRef.current.has(item.id)}
        bulkDragCount={bulkDragCount}
        effectiveArchived={item.archived || deckArchivedRef.current}
        // デッキごとアーカイブ中は全行がグレーだが、ここは「デッキ単位の2択ダイアログ」への
        // 入口として残す（隠すのはカード個別アーカイブのときだけ）。
        canStudyFromHere={deckArchivedRef.current || !item.archived}
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
    () => ({ selectionMode, selectedCardIds, focusedCardId, deckArchived: !!deck?.archived, dark: theme.dark, fontScale: theme.fontScale, bg: theme.colors.background }),
    [selectionMode, selectedCardIds, focusedCardId, deck?.archived, theme.dark, theme.fontScale, theme.colors.background],
  );

  // フィルター/ソート切替の体感レスポンス改善（500枚級デッキ対策）:
  // 選択 state（ブロックのハイライト・カウント表示）は即時に描画し、リスト本体の
  // データ入れ替え（表示ウィンドウ内セル≒windowSize分の同期再構築＝重い）は
  // useDeferredValue で次のレンダーに分離する。総コストは不変だがタップへの応答が
  // 先に画面へ出るため「押しても固まっている」感が消える。両側に多数のカードがある
  // フィルター同士（すべて↔復習など）や並び順が変わるソート切替で効く。
  // ※windowSize を絞る高速化は高速スクロール時のセル透明化とトレードオフのため不採用（828b9d5）。
  const deferredFilter = useDeferredValue(selectedFilter);
  const deferredSort = useDeferredValue(cardSortOrder);
  const deckCards = useMemo(() => cards.filter((c) => c.deckId === id), [cards, id]);
  const filteredCards = useMemo(
    () => deferredFilter === 'all'
      ? deckCards
      : deckCards.filter((c) => filterCardIds[deferredFilter].has(c.id)),
    [deckCards, deferredFilter, filterCardIds],
  );
  const displayedCards = useMemo(
    () => deferredSort === 'newest'
      ? [...filteredCards].sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0) || b.sortOrder - a.sortOrder)
      : deferredSort === 'oldest'
      ? [...filteredCards].sort((a, b) => (a.createdAt > b.createdAt ? 1 : a.createdAt < b.createdAt ? -1 : 0) || a.sortOrder - b.sortOrder)
      : filteredCards,
    [filteredCards, deferredSort],
  );

  // フィルターを切り替えたら先頭へ戻す。
  //
  // **即時値（selectedFilter）ではなく deferredFilter で発火させること。** 即時値だと、リストが
  // まだ古いフィルターの並びを表示したまま先頭へ飛び、「すべての並びが先頭に戻ってから復習の並びに
  // 変わる」という中間状態が deferred の一拍ぶん（重い切替ほど長い）見えてしまう。deferred 値なら
  // データ入れ替えと同じタイミングで当たるので、切替前の位置のまま新しい並びの先頭へ移る。
  // useLayoutEffect なのは、入れ替えのコミットと同じフレームでスクロールを当てて中間フレームを
  // 見せないため。
  //
  // かつてはフィルターごとにスクロール位置を記憶して復元していたが、それは機能していなかった：
  // 復元先のセルが未測定だと iOS はその時点の「推定」コンテンツ高さでクランプするため、50枚デッキで
  // 最下部から戻っても10枚ぶん手前で止まる。500枚級ではさらに、着地後もセルの実測が進むたびに
  // コンテンツ高さが伸びて位置がずれ、見えるセルが変わってまた実測……とリストが上下に揺れ続けた。
  // フィルター切替は項目の集合ごと入れ替わる＝新しい並びのセル位置は必ず未測定なので、これを毎回踏む
  // （モーダルから戻るときの位置復元は同じデータのままで測定値が残るため、こちらは問題ない）。
  // オフセット0は推定に依存しない唯一の位置＝原理的に揺れない。位置の記憶は復活させないこと。
  useLayoutEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [deferredFilter]);
  // リストの種別（DraggableFlatList/FlatList）とセル内の ScaleDecorator 有無は、
  // 表示中のデータと同じ deferred 値から決める（即時値だとデータ更新前に種別だけ
  // 先に入れ替わり、余計な再マウントが挟まる）。
  const listIsDraggable = deferredSort === 'manual' && deferredFilter === 'all' && !manualSortLocked;
  const listIsDraggableRef = useRef(listIsDraggable);
  listIsDraggableRef.current = listIsDraggable;

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
            toggleCardSelected(displayedCards[focusedCardIndex].id);
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
    // U/D: 通常モード＝フォーカスカードを手動並べ替え／選択モード＝選択カードをまとめ並べ替え（038）。
    // いずれも手動ソート・「すべて」フィルター時のみ有効。
    { input: 'u', handler: () => { if (showDeckPicker || statsCardId !== null) return; if (selectionMode) moveSelectedCards('up'); else moveCardOrder('up'); } },
    { input: 'd', handler: () => { if (showDeckPicker || statsCardId !== null) return; if (selectionMode) moveSelectedCards('down'); else moveCardOrder('down'); } },
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
    // E = アーカイブ切替（全画面で E に統一）。Delete と同じ「選択モード＝選択カード／
    //   通常モード＝フォーカスカード」の流儀。復習/新規フィルターではアーカイブすると
    //   その行が消えるため、キー操作にはピル通知を添える（スワイプはボタン表示があるので不要）。
    { input: 'e', handler: () => {
      if (showDeckPicker || statsCardId !== null) return;
      if (selectionMode) {
        if (selectedCardIds.size > 0 && !isProcessing) handleArchiveSelected();
      } else if (focusedCardIndex !== null && displayedCards[focusedCardIndex]) {
        const card = displayedCards[focusedCardIndex];
        archiveCard(card);
        showArchivePill(!card.archived);
      }
    } },
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
  ], !showDeckPicker && !showDeleteModal && !pendingMoveDeck && !infoModal && !showShortcutsModal && !archivedStudyPrompt);

  // ESC は常時有効：デッキ選択はピッカー側へ委譲、以降オーバーレイ → 選択モード解除 → 戻る。削除系は Return 非割当。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (showDeckPicker) return; // DeckPickerModal 側の Esc が閉じる
        if (statsCardId !== null) { setStatsCardId(null); return; }
        if (showDeleteModal) { setShowDeleteModal(false); return; }
        if (archivedStudyPrompt) { setArchivedStudyPrompt(null); return; }
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

  // 学習開始の対象カード列：画面に見えている並び順（フィルタ済み・ソート済み）そのまま。
  // セッション側で並びを再計算すると createdAt 同値の tie-break 差で見た目とズレるため、
  // 表示中のカード ID 列を明示的に渡して順序を厳守させる。startId を渡すと「ここから学習」＝
  // そのカードから一覧末尾まで（全体開始の部分集合）になる。
  const studySliceFrom = (startId?: string | null): Card[] => {
    if (!startId) return displayedCards;
    const startIdx = displayedCards.findIndex((c) => c.id === startId);
    return startIdx === -1 ? [] : displayedCards.slice(startIdx);
  };

  const pushStudySession = (cardIds: string[], browse: boolean) => {
    if (cardIds.length === 0) return;
    // 巨大IDをURLパラメータに載せると（数万枚デッキで）ルート状態のシリアライズに
    // 数秒かかるため、ストア経由で渡し params は order フラグだけにする。
    setStudyCardIds(cardIds);
    router.push({
      pathname: '/study/session',
      params: { deckId: id, order: '1', ...(browse ? { browse: '1' } : {}) },
    });
  };

  // 学習開始の入口（学習ボタン・Space・⇧Space・右スワイプ「ここから学習」で共用）。
  // デッキがアーカイブ中のときだけ2択ダイアログを挟む（解除して学習／閲覧のみ）。
  // 通常デッキではアーカイブ済みカードだけを黙って除外して開始する（032 の方針どおり）。
  const requestStudy = (startId?: string) => {
    const slice = studySliceFrom(startId);
    if (slice.length === 0) return;
    if (deck.archived) {
      setArchivedStudyPrompt({ startId: startId ?? null });
      return;
    }
    pushStudySession(slice.filter((c) => !c.archived).map((c) => c.id), false);
  };

  // 学習ボタンの活性。通常デッキ＝学習可能カード（非アーカイブ）が1枚以上あるとき。
  // アーカイブ中デッキ＝一覧に1枚でもあれば押せる（押すと2択ダイアログ）。
  // ※「押せるのに無反応」を作らないため、開始できない条件はここに集約する。
  const canStartStudy = deck.archived ? displayedCards.length > 0 : displayedCards.some((c) => !c.archived);

  const startVisibleStudy = () => requestStudy();
  const startStudyFromCard = (startId: string) => requestStudy(startId);
  startStudyFromCardRef.current = startStudyFromCard;

  // アーカイブ中デッキの2択。
  // ・解除して学習＝デッキの archived だけを戻す（個別アーカイブのカードは戻さない＝非可逆な
  //   一括復活を避ける）ので、対象は通常学習と同じ「非アーカイブカードのみ」。
  // ・閲覧のみ＝記録を残さないので学習対象の概念が無く、一覧に見えているカードをそのまま送る
  //   （アーカイブ済みカードも含む＝「ここから」が指したカードから確実に始まる）。
  const promptSlice = archivedStudyPrompt ? studySliceFrom(archivedStudyPrompt.startId) : [];
  const promptStudyIds = promptSlice.filter((c) => !c.archived).map((c) => c.id);
  // 閉じる瞬間（フェード中）にボタンが2→1へ減って見えないよう、直前の選択肢構成を保持する
  // （InfoModal の lastInfoModalRef と同じ流儀）。
  if (archivedStudyPrompt) promptHasUnarchiveRef.current = promptStudyIds.length > 0;

  const unarchiveAndStudy = async () => {
    setArchivedStudyPrompt(null);
    await setDeckArchived(db, deck.id, false);
    updateDeck({ ...deck, archived: false });
    pushStudySession(promptStudyIds, false);
  };

  const browseArchivedDeck = () => {
    setArchivedStudyPrompt(null);
    pushStudySession(promptSlice.map((c) => c.id), true);
  };

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
      // ヌルサイクルの折り返しのうち「末尾へ」（ci===null → 最後のカード）だけ「移動中」ピルを出す
      // （先頭へは常に一瞬なので不要）。ただし目的カードが既に画面に見えている場合はスクロールが
      // 動かず onViewableItemsChanged も発火しない（＝閉じられない）ので、最初から出さない。
      // 目的カードが可視になったら同ハンドラが閉じる。
      if (ci === null && next === displayedCards.length - 1 && newId && !viewableKeysRef.current.has(newId)) startJumpIndicator(newId);
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
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: <InfoContent text={t('card.reorderDisabledMessage')} /> });
      return;
    }
    if (cardSortOrder !== 'manual') {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: <InfoContent text={t('card.reorderDisabledMessageSort')} /> });
      return;
    }
    if (manualSortLocked) {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: <InfoContent text={t('card.reorderLockedMessage')} /> });
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

  // 038 Phase1: 選択モードの U/D = 選択カードのまとめ並べ替え。
  // 選択カード群（表示順のまま）を「U=選択中の最上部カードの1つ上 / D=最下部カードの1つ下」の
  // 位置へ集約配置する。毎回の押下が移動方向への変化になり、離れた選択は移動方向へ集約、
  // 隣接ブロックは1つずつ上下移動する（この式の自然な帰結）。端ではクランプ（先頭/末尾に
  // 集約済みなら無反応）。選択順には一切依存しない＝結果が見た目から完全に予測できる
  // （2026-07-18 決定。「最初に選択した位置へ集約」案は選択順が画面に見えないため不採用）。
  // 有効条件・案内アラートは単一並べ替え（moveCardOrder）と同じ。
  function moveSelectedCards(dir: 'up' | 'down') {
    if (selectedFilter !== 'all') {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: <InfoContent text={t('card.reorderDisabledMessage')} /> });
      return;
    }
    if (cardSortOrder !== 'manual') {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: <InfoContent text={t('card.reorderDisabledMessageSort')} /> });
      return;
    }
    if (manualSortLocked) {
      setInfoModal({ title: t('card.reorderDisabledTitle'), message: <InfoContent text={t('card.reorderLockedMessage')} /> });
      return;
    }
    const group = displayedCards.filter((c) => selectedCardIds.has(c.id));
    if (group.length === 0) return;
    const others = displayedCards.filter((c) => !selectedCardIds.has(c.id));
    const idxTop = displayedCards.findIndex((c) => selectedCardIds.has(c.id));
    let idxBottom = -1;
    for (let i = displayedCards.length - 1; i >= 0; i--) {
      if (selectedCardIds.has(displayedCards[i].id)) { idxBottom = i; break; }
    }
    // 挿入位置 p ＝ 最終配置でのブロック先頭位置（選択カードを除いた others への挿入位置と一致）
    const p = dir === 'up'
      ? Math.max(0, idxTop - 1)
      : Math.min(others.length, idxBottom + 2 - group.length);
    const newOrder = [...others.slice(0, p), ...group, ...others.slice(p)];
    if (newOrder.every((c, i) => c.id === displayedCards[i].id)) return; // 端クランプで無変化
    reorderCards(newOrder);
    updateCardSortOrders(db, newOrder.map((c) => c.id));
    // 移動方向の端（上=ブロック先頭 / 下=ブロック末尾）が見える位置へスクロール
    const scrollIdx = dir === 'up' ? p : Math.min(p + group.length - 1, newOrder.length - 1);
    setTimeout(() => listRef.current?.scrollToIndex({ index: scrollIdx, viewPosition: 0.5, animated: true }), 50);
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
          style={[styles.studyBtn, { backgroundColor: theme.colors.primary }, (selectionMode || (filtersReady && !canStartStudy)) && { opacity: 0.5 }]}
          activeOpacity={0.8}
          disabled={selectionMode || !canStartStudy}
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

      {/* 余白タップ解除はリスト内フッター（ListFooterComponent）が担う。ここを Pressable にすると
          押せる要素のない場所からのドラッグでスクロールが始まらない不具合がある（統計参照）。 */}
      <View style={{ flex: 1 }}>
        {/* DraggableFlatList は「ドラッグ並べ替えが実際に効く＝すべて＋手動」のときだけ使う。
            それ以外（新しい/古い順、または手動でも 済み/復習/新規 フィルター）は素の FlatList。
            理由: DraggableFlatList はセルのジェスチャー処理が横スワイプ（削除/アーカイブ）を奪うため、
            ドラッグ不可の画面では素の FlatList にしてスワイプを効かせる。all↔他フィルターの切替で
            list 種別が変わり再マウントするが、手動ソート時に限られるため許容。
            分岐はデータと同じ deferred 由来の listIsDraggable で判定する（体感レスポンス改善）。 */}
        {listIsDraggable ? (
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
            scrollsToTop={scrollsToTopArmed}
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
                title={deferredFilter === 'all' ? t('deck.noCards') : t('deck.noCardsInFilter')}
                subtitle={deferredFilter === 'all' ? t('deck.noCardsSub') : undefined}
              />
            }
            contentContainerStyle={[styles.container, selectionMode && { paddingBottom: 160 }]}
            onScrollToIndexFailed={handleScrollToIndexFailed}
            onDragEnd={({ data, from, to }) => {
              if (selectedFilter !== 'all' || cardSortOrder !== 'manual') return;
              if (selectionMode) {
                // 038 Phase3: まとめ移動（ドロップ時展開方式）。ライブラリはアンカー1枚だけを
                // from→to に動かした data を返すので、そこから「選択カードを抜き、アンカーの
                // 落ちた隙間に選択カード群（ドラッグ前の表示順）を挿入」した最終並びを作る。
                // 動かさず元の位置に落とした場合はキャンセル（散在選択でも集約しない）。
                if (from === to) return;
                const sel = selectedCardIdsRef.current;
                const dragged = data[to];
                if (!dragged || !sel.has(dragged.id)) return; // 保険（未選択行はドラッグ開始しない）
                let gap = 0;
                for (let i = 0; i < to; i++) if (!sel.has(data[i].id)) gap++;
                const others = data.filter((c) => !sel.has(c.id));
                const group = displayedCards.filter((c) => sel.has(c.id));
                const newOrder = [...others.slice(0, gap), ...group, ...others.slice(gap)];
                reorderCards(newOrder);
                updateCardSortOrders(db, newOrder.map((c) => c.id));
                return;
              }
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
            scrollsToTop={scrollsToTopArmed}
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
                title={deferredFilter === 'all' ? t('deck.noCards') : t('deck.noCardsInFilter')}
                subtitle={deferredFilter === 'all' ? t('deck.noCardsSub') : undefined}
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
      </View>

      {jumpPill && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={[styles.jumpPill, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('card.jumpingToBottom')}
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
      {/* アーカイブ中デッキで学習開始したときの2択（選択式なので Return は割り当てない＝タップ/Esc）。
          解除して学習は「解除後に学習できるカードがある」ときだけ出す。 */}
      <ConfirmModal
        visible={!!archivedStudyPrompt}
        title={t('deck.archivedStudyTitle')}
        message={t('deck.archivedStudyMessage')}
        actions={[
          ...(promptHasUnarchiveRef.current
            ? [{ label: t('deck.archivedStudyUnarchive'), onPress: unarchiveAndStudy }]
            : []),
          { label: t('deck.archivedStudyBrowse'), onPress: browseArchivedDeck },
        ]}
        onClose={() => setArchivedStudyPrompt(null)}
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
      <ArchivePill archived={archivePill} />
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
