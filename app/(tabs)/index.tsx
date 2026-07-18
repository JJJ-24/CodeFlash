import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { setStatusBarHidden, setStatusBarStyle } from 'expo-status-bar';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { constants as KeyCommand } from 'react-native-key-command';

import { ArchivePill, useArchivePill } from '@/components/ArchivePill';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { InfoModal } from '@/components/InfoModal';
import { InfoContent } from '@/components/InfoContent';
import { SwipeToDeleteRow } from '@/components/SwipeToDeleteRow';
import { EmptyState } from '@/components/EmptyState';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { resolveDeckIconColors } from '@/lib/deckIconColors';
import { deleteKeySpecs, useKeyCommands } from '@/lib/useKeyCommands';
import { useLockedHeaderHeights } from '@/lib/useLockedTopInset';
import { useSafeScrollsToTop } from '@/lib/useSafeScrollsToTop';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW, fontSizeForDigits, themedFrameBorder } from '@/lib/theme';
import { deleteDeck, getAllDecks, setDeckArchived, updateDeckSortOrders } from '@/lib/database/decks';
import { sortDecks } from '@/lib/sortDecks';
import { useListNavigation } from '@/hooks/useListNavigation';
import { useDeckStore } from '@/store/decks';
import { usePendingFocusStore } from '@/store/pendingFocus';
import { useSyncStore } from '@/store/sync';
import { useSettingsStore, type DeckSortOrder } from '@/store/settings';
import type { Deck } from '@/types';

// ショートカット一覧を6カテゴリー（表示/フォーカス・選択/移動/操作/文字装飾/その他）に分類。
// 該当するカテゴリーだけを並べる（順序固定・同じキーは全画面で同じ分類）。
const HOME_SHORTCUT_SECTIONS = [
  {
    titleKey: 'shortcut.catDisplay',
    items: [
      { key: '1 / 2', descKey: 'shortcut.switchFilterAllActive' },
      { key: 'M / ⇧M', descKey: 'shortcut.cycleSort' },
      { key: '⌘L', descKey: 'shortcut.toggleSortLock' },
    ],
  },
  {
    titleKey: 'shortcut.catFocus',
    items: [
      { key: 'J / K',   descKey: 'shortcut.focusNextPrev' },
      { key: 'U / D',   descKey: 'shortcut.reorderUpDown' },
      { key: 'Return', descKey: 'shortcut.openFocused' },
      { key: 'P',     descKey: 'shortcut.editFocused' },
      { key: 'E',     descKey: 'shortcut.archiveFocused' },
      { key: 'Delete', descKey: 'shortcut.deleteFocused' },
    ],
  },
  {
    titleKey: 'shortcut.catNavigate',
    items: [
      { key: 'N',     descKey: 'shortcut.new' },
      { key: 'F',     descKey: 'shortcut.search' },
      { key: 'T',     descKey: 'shortcut.tags' },
      { key: 'Tab / ⇧Tab', descKey: 'shortcut.tabNextPrev' },
    ],
  },
  {
    titleKey: 'shortcut.catOther',
    items: [
      { key: 'ESC',  descKey: 'shortcut.esc' },
      { key: '?',    descKey: 'shortcut.showShortcuts' },
    ],
  },
];

function truncate(str: string, max = 20): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function DeckCard({
  deck,
  drag,
  onEdit,
  onPress,
  isFocused,
}: {
  deck: Deck;
  drag: (() => void) | null;
  onEdit: (id: string) => void;
  onPress: () => void;
  isFocused?: boolean;
}) {
  const theme = useTheme();
  const { color: iconColor, bg: iconBg } = resolveDeckIconColors(deck.colorHex, theme);
  // デッキアイコンを文字サイズ設定（fontScale）に連動させる
  const iconBoxSize = Math.round(32 * theme.fontScale);
  const iconGlyphSize = Math.round(18 * theme.fontScale);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface },
        deck.archived && { opacity: 0.55 },
        isFocused && { borderWidth: 2, borderColor: theme.colors.primary },
      ]}
      onPress={onPress}
      onLongPress={drag ?? undefined}
      activeOpacity={0.7}
    >
      {deck.iconName && (
        <View style={[styles.deckIcon, { width: iconBoxSize, height: iconBoxSize, borderRadius: iconBoxSize / 2, backgroundColor: iconBg }]}>
          <Ionicons name={deck.iconName as any} size={iconGlyphSize} color={iconColor} />
        </View>
      )}
      <View style={styles.cardContent}>
        <Text style={[styles.deckName, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {deck.name}
        </Text>
        {deck.description ? (
          <Text style={[styles.deckDesc, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {deck.description}
          </Text>
        ) : null}
      </View>
      <View style={styles.cardActions}>
        {deck.archived && (
          <Ionicons name="archive" size={theme.fontSize.lg} color={theme.colors.textTertiary} style={{ marginRight: 4 }} />
        )}
        <View style={[styles.countBadge, { backgroundColor: theme.dark ? '#4B5563' : '#8B949E', marginRight: 8 }]}>
          <Text style={[styles.countBadgeText, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{deck.cardCount}</Text>
        </View>
        <Pressable
          onPress={() => onEdit(deck.id)}
          hitSlop={8}
          style={styles.iconBtn}
        >
          <Ionicons name="pencil-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
        </Pressable>
        <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

const SORT_OPTIONS: { key: DeckSortOrder; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'manual',    icon: 'reorder-three-outline' },
  { key: 'name',      icon: 'text-outline' },
  { key: 'cardCount', icon: 'layers-outline' },
];

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  // ステータスバー文字色の復元は deps:[] の focus effect 内から参照するため、常に最新値を ref で渡す。
  const darkRef = useRef(theme.dark);
  darkRef.current = theme.dark;
  const { decks, setDecks, removeDeck, reorderDecks, updateDeck } = useDeckStore();
  const takePendingFocus = usePendingFocusStore((s) => s.takePendingFocus);
  const { deckSortOrder, setDeckSortOrder, deckSortLocked, setDeckSortLocked, keyboardShortcutsEnabled, lastHomeFilter, setLastHomeFilter } = useSettingsStore();
  const { width } = useWindowDimensions();
  // 学習/統計タブの1ブロック実幅に一致させる（コンテナ余白16・行 marginHorizontal:-2・各ブロック margin:2・gap:4 の4列構成）
  const blockWidth = (width - 56) / 4;
  const filterBlockMinHeight = 32 + Math.ceil(fontSizeForDigits(theme, 1) * 1.35) + 2 + Math.ceil(theme.fontSize.xs * 1.35);
  // ホームのデッキ絞り込み（active=有効デッキのみ / all=アーカイブ含む全デッキ）。最後の選択を永続化。
  const selectedFilter = lastHomeFilter;
  const setSelectedFilter = setLastHomeFilter;
  // ステータスバータップで先頭へ戻す（iOS標準 scrollsToTop）用。有効な縦スクロールビューが
  // 画面上に複数あると iOS が機能自体を無効化するため、フォーカス中の画面のリストだけ有効にする。
  // さらに iPadOS 26 はポップ遷移終了時に scrollsToTop を誤発火させる（下へスクロールした状態で
  // push 画面から戻ると一瞬ちらつく）ため、フォーカス直後 800ms も無効のままにする
  // （詳細は lib/useSafeScrollsToTop.ts）。
  const scrollsToTopArmed = useSafeScrollsToTop();
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showDeckListInfo, setShowDeckListInfo] = useState(false);
  // U/D 並べ替え不可時の案内（カード一覧・タグ管理と同方針・文言も card.* を流用）。
  // 閉じる瞬間にフェード中の中身が空にならないよう直前内容を ref で保持する。
  const [reorderInfo, setReorderInfo] = useState<React.ReactNode | null>(null);
  const lastReorderInfoRef = useRef<React.ReactNode | null>(null);
  if (reorderInfo) lastReorderInfoRef.current = reorderInfo;
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingDeleteDeck, setPendingDeleteDeck] = useState<Deck | null>(null);
  const scrollOffsetRef = useRef(0);
  const savedScrollOffsetRef = useRef(0);
  const restorationEndTimeRef = useRef(0);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    getAllDecks(db).then(setDecks);
  }, [db]);

  // 同期（ダウンロード）でローカルデータが入れ替わったら、デッキ一覧を再読込する。
  // refreshGlobalCaches でストアは更新されるが、念のためここでも DB から再取得して確実に反映する。
  const dataRevision = useSyncStore((s) => s.dataRevision);
  useEffect(() => {
    if (dataRevision === 0) return;
    getAllDecks(db).then(setDecks);
  }, [dataRevision, db, setDecks]);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      // WKWebView がネイティブクリーンアップ時に iOS ステータスバー状態（表示・文字色）を
      // 上書きするため、フォーカス直後から複数タイミングで復元して確実に打ち勝つ。
      // insets.top 監視ではノッチ/Dynamic Island iPhone でステータスバーを隠しても
      // insets.top が変化しないため機能しない。文字色も直さないとダークモードで黒いままになる。
      const restoreStatusBar = () => {
        if (!isFocusedRef.current) return;
        setStatusBarStyle(darkRef.current ? 'light' : 'dark', false);
        setStatusBarHidden(false, 'none');
      };
      restoreStatusBar();
      const sbTid1 = setTimeout(restoreStatusBar, 200);
      const sbTid2 = setTimeout(restoreStatusBar, 550);
      // 新規デッキ作成から戻った場合は、作成デッキへフォーカス＋スクロール（スクロール位置復元はしない）。
      const pendingFocusDeck = takePendingFocus('deck');
      let tid1: ReturnType<typeof setTimeout>;
      if (pendingFocusDeck) {
        setFocusDeckId(pendingFocusDeck);
        restorationEndTimeRef.current = 0;
        tid1 = setTimeout(() => {
          if (!isFocusedRef.current) return;
          const idx = displayedDecksRef.current.findIndex((d) => d.id === pendingFocusDeck);
          if (idx !== -1) listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true });
        }, 120);
      } else {
        const targetOffset = savedScrollOffsetRef.current;
        restorationEndTimeRef.current = Date.now() + 800;
        tid1 = setTimeout(() => {
          listRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
        }, 50);
      }
      return () => {
        isFocusedRef.current = false;
        clearTimeout(sbTid1);
        clearTimeout(sbTid2);
        clearTimeout(tid1);
        restorationEndTimeRef.current = 0;
        savedScrollOffsetRef.current = scrollOffsetRef.current;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // React Navigation の標準ヘッダーと同じ算出（Dynamic Island 補正込み）＋縮まない inset。
  // 詳細は lib/useLockedTopInset.ts の useLockedHeaderHeights を参照。
  const headerHeights = useLockedHeaderHeights();

  async function handleDelete(id: string) {
    await deleteDeck(db, id);
    removeDeck(id);
  }

  async function toggleDeckArchive(deck: Deck) {
    const next = !deck.archived;
    await setDeckArchived(db, deck.id, next);
    updateDeck({ ...deck, archived: next });
    // 操作した行にフォーカスを移す（行タップ/編集ボタンと同じ流儀。スワイプだけ例外にしない）。
    // 「有効」フィルターでは行が消えるが、focusedId は保持されるので「すべて」に戻せば
    // 青枠が復活する。scrollToIndex で追いかけるのは不可（カード一覧 archiveCard のコメント参照）。
    setFocusDeckId(deck.id);
  }

  async function handleDeleteConfirm() {
    if (!pendingDeleteDeck) return;
    setShowDeleteModal(false);
    await handleDelete(pendingDeleteDeck.id);
    setPendingDeleteDeck(null);
  }

  const sortedDecks = useMemo(() => sortDecks(decks, deckSortOrder), [decks, deckSortOrder]);
  const activeDeckCount = useMemo(() => decks.filter((d) => !d.archived).length, [decks]);
  const displayedDecks = useMemo(
    () => (selectedFilter === 'active' ? sortedDecks.filter((d) => !d.archived) : sortedDecks),
    [sortedDecks, selectedFilter]
  );
  // 手動ソート かつ 未ロックのときだけドラッグ並べ替えが有効。ロック中はドラッグを止めてスワイプ可にする。
  const deckDragActive = deckSortOrder === 'manual' && !deckSortLocked;

  function cycleSortOrder(dir = 1) {
    const n = SORT_OPTIONS.length;
    const idx = SORT_OPTIONS.findIndex((o) => o.key === deckSortOrder);
    const next = SORT_OPTIONS[(idx + dir + n) % n];
    setDeckSortOrder(next.key);
  }

  const { focusedIndex: focusedDeckIndex, setFocusedIndex: setFocusedDeckIndex, setFocusId: setFocusDeckId, listRef, moveFocus: moveDeckFocus } = useListNavigation(displayedDecks, (deck) => deck.id);
  const { archivePill, showArchivePill } = useArchivePill();
  // フォーカス effect（deps 空）から最新の一覧を参照するための ref
  const displayedDecksRef = useRef(displayedDecks);
  displayedDecksRef.current = displayedDecks;

  // キーボードでの手動並べ替え（U=上へ / D=下へ）。手動ソート時のみ。フォーカスは ID 追跡で自動追従。
  // 並べ替え不可の状態ではカード一覧・タグ管理と同じ案内アラートを出す（無反応だと原因が
  // 分からないため。2026-07-18 に「静かに無効」から変更）。
  // 非表示（アーカイブ）デッキは元位置に固定したまま表示中だけを並べ替える（onDragEnd と同じ再構築）。
  function moveDeckOrder(dir: 'up' | 'down') {
    if (deckSortOrder !== 'manual') {
      setReorderInfo(<InfoContent text={t('card.reorderDisabledMessageSort')} />);
      return;
    }
    if (deckSortLocked) {
      setReorderInfo(<InfoContent text={t('card.reorderLockedMessage')} />);
      return;
    }
    if (focusedDeckIndex === null) return;
    const to = dir === 'up' ? focusedDeckIndex - 1 : focusedDeckIndex + 1;
    if (to < 0 || to >= displayedDecks.length) return;
    const newDisplayed = [...displayedDecks];
    const [moved] = newDisplayed.splice(focusedDeckIndex, 1);
    newDisplayed.splice(to, 0, moved);
    const visibleIds = new Set(newDisplayed.map((d) => d.id));
    let vi = 0;
    const full = sortedDecks.map((d) => (visibleIds.has(d.id) ? newDisplayed[vi++] : d));
    reorderDecks(full);
    updateDeckSortOrders(db, full.map((d) => d.id));
    setTimeout(() => listRef.current?.scrollToIndex({ index: to, viewPosition: 0.5, animated: true }), 50);
  }

  const StatsHeader = (
    <View style={styles.statsHeader}>
      <View style={styles.statsRow}>
        {/* すべて（左端・青数字、他画面と統一） */}
        <Pressable
          style={[
            styles.statItem,
            { backgroundColor: theme.colors.surface, width: blockWidth, minHeight: filterBlockMinHeight },
            selectedFilter === 'all' && { margin: 0, borderWidth: 2, borderColor: theme.colors.primary },
          ]}
          onPress={() => setSelectedFilter('all')}
        >
          <Text numberOfLines={1} allowFontScaling={false} style={[styles.statValue, { color: theme.colors.primary, fontSize: fontSizeForDigits(theme, (Platform as any).isPad ? 1 : String(decks.length).length) }]}>{decks.length}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('common.all')}</Text>
        </Pressable>
        {/* 有効（既定選択・グレー数字。どちらを開いているかは青の選択枠で示す） */}
        <Pressable
          style={[
            styles.statItem,
            { backgroundColor: theme.colors.surface, width: blockWidth, minHeight: filterBlockMinHeight },
            selectedFilter === 'active' && { margin: 0, borderWidth: 2, borderColor: theme.colors.primary },
          ]}
          onPress={() => setSelectedFilter('active')}
        >
          <Text numberOfLines={1} allowFontScaling={false} style={[styles.statValue, { color: theme.colors.text, fontSize: fontSizeForDigits(theme, (Platform as any).isPad ? 1 : String(activeDeckCount).length) }]}>{activeDeckCount}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('common.active')}</Text>
        </Pressable>
      </View>
      <View style={styles.sectionRow}>
        <View style={styles.sectionTitleCol}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('home.title')}
            </Text>
            <Pressable onPress={() => setShowDeckListInfo(true)} hitSlop={8} accessibilityLabel={t('home.deckListInfoLabel')}>
              <Ionicons name="information-circle-outline" size={Math.max(theme.fontSize.lg, 20)} color={theme.colors.textTertiary} />
            </Pressable>
          </View>
          <Text style={[{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {deckSortOrder === 'manual' && deckSortLocked
              ? t('home.sortDescManualLocked')
              : t(`home.sortDesc${deckSortOrder.charAt(0).toUpperCase()}${deckSortOrder.slice(1)}`)}
          </Text>
        </View>
        <View style={styles.sortButtons}>
          {/* 手動ソート時のみ表示：ドラッグ並べ替えロック（ON=固定してスワイプ可）。左端・枠なしアイコンのみ。 */}
          {deckSortOrder === 'manual' && (
            <Pressable
              // paddingVertical はソートチップ（styles.sortBtn の 4）に合わせる。大きいと
              // ロックがチップより背高になり、手動切替時に行の高さが増えて他アイコンが下にずれる。
              style={{ justifyContent: 'center', alignItems: 'center', paddingVertical: 4, paddingHorizontal: (Platform as any).isPad ? 12 : 6 }}
              hitSlop={8}
              onPress={() => setDeckSortLocked(!deckSortLocked)}
            >
              <Ionicons
                name={deckSortLocked ? 'lock-closed' : 'lock-open-outline'}
                size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)}
                color={deckSortLocked ? theme.colors.primary : theme.colors.textSecondary}
              />
            </Pressable>
          )}
          {SORT_OPTIONS.map(({ key, icon }) => {
            const active = deckSortOrder === key;
            return (
              <Pressable
                key={key}
                onPress={() => setDeckSortOrder(key)}
                style={[
                  styles.sortBtn,
                  { borderColor: active ? theme.colors.primary : themedFrameBorder(theme), paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
                  active && { backgroundColor: theme.colors.primary },
                ]}
              >
                <Ionicons
                  name={icon}
                  size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)}
                  color={active ? theme.colors.primaryText : theme.colors.textSecondary}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );

  // ←/→・,/.・H/L でフィルター（すべて/有効）を循環切替（学習/編集の横移動と同じ操作軸）。
  function cycleHomeFilter(dir: 'prev' | 'next') {
    const order = ['all', 'active'] as const;
    const i = order.indexOf(selectedFilter);
    setSelectedFilter(order[((i < 0 ? 0 : i) + (dir === 'next' ? 1 : -1) + order.length) % order.length]);
  }

  // 034: 隠し TextInput + onKeyPress/onSubmitEditing をネイティブキーコマンドへ置換。
  // フックが「画面フォーカス中 かつ keyboardShortcutsEnabled」を内部で gate する。
  // Return は keyInputEnter（iOS では '\r'）で受ける（旧 onSubmitEditing の代替）。
  useKeyCommands([
    { input: '1', handler: () => setSelectedFilter('all') },
    { input: '2', handler: () => setSelectedFilter('active') },
    { input: 'm', handler: () => cycleSortOrder() },
    { input: 'm', modifierFlags: KeyCommand.keyModifierShift, handler: () => cycleSortOrder(-1) },
    // ⌘L = ドラッグ並べ替えロックの切替（手動ソート時のみ）。L 単独はフィルター切替のため修飾必須。
    { input: 'l', modifierFlags: KeyCommand.keyModifierCommand, handler: () => { if (deckSortOrder === 'manual') setDeckSortLocked(!deckSortLocked); } },
    { input: 'j', handler: () => moveDeckFocus('next') },
    { input: 'k', handler: () => moveDeckFocus('prev') },
    // U/D: フォーカス中のデッキを手動並べ替え（上へ/下へ）。手動ソート時のみ有効。
    { input: 'u', handler: () => moveDeckOrder('up') },
    { input: 'd', handler: () => moveDeckOrder('down') },
    {
      input: 'p',
      handler: () => {
        if (focusedDeckIndex !== null && displayedDecks[focusedDeckIndex]) {
          router.push({ pathname: '/deck/[id]/edit', params: { id: displayedDecks[focusedDeckIndex].id } });
        }
      },
    },
    ...deleteKeySpecs(() => {
      if (focusedDeckIndex !== null && displayedDecks[focusedDeckIndex]) {
        setPendingDeleteDeck(displayedDecks[focusedDeckIndex]);
        setShowDeleteModal(true);
      }
    }),
    // E = フォーカス中デッキのアーカイブ切替（全画面で E に統一）。ホームには選択モードが
    //   無いため、これがキーボードからアーカイブする唯一の手段。「有効」フィルターでは
    //   アーカイブすると行が消えるので、ピル通知を添える。
    { input: 'e', handler: () => {
      if (focusedDeckIndex !== null && displayedDecks[focusedDeckIndex]) {
        const deck = displayedDecks[focusedDeckIndex];
        toggleDeckArchive(deck);
        showArchivePill(!deck.archived);
      }
    } },
    { input: 'n', handler: () => router.push({ pathname: '/deck/new' }) },
    { input: 'f', handler: () => router.push('/search') },
    // ⌘F = 検索（OS 慣習のエイリアス）
    { input: 'f', modifierFlags: KeyCommand.keyModifierCommand, handler: () => router.push('/search') },
    { input: 't', handler: () => router.push('/tags') },
    // ←/→・,/.・H/L = フィルター切替（タブ切替は Tab/Shift+Tab に一本化）
    { input: ',', handler: () => cycleHomeFilter('prev') },
    { input: '.', handler: () => cycleHomeFilter('next') },
    { input: 'h', handler: () => cycleHomeFilter('prev') },
    { input: 'l', handler: () => cycleHomeFilter('next') },
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (focusedDeckIndex !== null && displayedDecks[focusedDeckIndex]) {
          router.push({ pathname: '/deck/[id]', params: { id: displayedDecks[focusedDeckIndex].id } });
        }
      },
    },
    // 矢印キー: 上下=K/J（フォーカス移動）、左右=,/.（フィルター切替）。タブ切替は Tab/Shift+Tab。
    { input: KeyCommand.keyInputUpArrow, handler: () => moveDeckFocus('prev') },
    { input: KeyCommand.keyInputDownArrow, handler: () => moveDeckFocus('next') },
    { input: KeyCommand.keyInputLeftArrow, handler: () => cycleHomeFilter('prev') },
    { input: KeyCommand.keyInputRightArrow, handler: () => cycleHomeFilter('next') },
    // Tab=次タブ・Shift+Tab=前タブ（タブ切替の唯一手段）。
    { input: '\t', handler: () => router.navigate('/(tabs)/study') },
    { input: '\t', modifierFlags: KeyCommand.keyModifierShift, handler: () => router.navigate('/(tabs)/settings') },
    // ?（Shift+/）= ショートカット一覧を開く（閉じる/トグルは ShortcutsModal 側が担当）
    { input: '/', modifierFlags: KeyCommand.keyModifierShift, handler: () => setShowShortcutsModal((v) => !v) },
  // アラート（削除確認/情報/ショートカット一覧）表示中は背景のショートカットを解除（Esc は別フックで常時有効）。
  ], !showDeleteModal && !showShortcutsModal && !showDeckListInfo && !reorderInfo);

  // ESC は常時有効：開いているオーバーレイを閉じる → フォーカス解除（ホームはタブなので戻るは無し）。
  // 削除確認は「削除」操作のため Return は割り当てない（タップのみ）。Esc/タップでキャンセル。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEscape,
      handler: () => {
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
        if (showDeckListInfo) { setShowDeckListInfo(false); return; }
        if (reorderInfo) { setReorderInfo(null); return; }
        if (showDeleteModal) { setShowDeleteModal(false); setPendingDeleteDeck(null); return; }
        if (focusedDeckIndex !== null) setFocusedDeckIndex(null);
      },
    },
  ]);

  // 「OK のみ」アラート（情報/ショートカット一覧）は Return=OK。表示中のみ有効（main は解除済み）。
  useKeyCommands([
    {
      input: KeyCommand.keyInputEnter,
      handler: () => {
        if (showDeckListInfo) { setShowDeckListInfo(false); return; }
        if (reorderInfo) { setReorderInfo(null); return; }
        if (showShortcutsModal) { setShowShortcutsModal(false); return; }
      },
    },
  ], showDeckListInfo || showShortcutsModal || Boolean(reorderInfo));

  // デッキ行の共通レンダラー（DraggableFlatList / 素の FlatList 両分岐で共用）。
  // ScaleDecorator はドラッグ有効時のみ呼び出し側で被せる。
  const renderDeckRow = (item: Deck, index: number | undefined, drag: (() => void) | null) => (
    <SwipeToDeleteRow
      enabled={!deckDragActive}
      onDelete={() => { setPendingDeleteDeck(item); setShowDeleteModal(true); }}
      onArchive={() => toggleDeckArchive(item)}
      archived={item.archived}
    >
      <DeckCard
        deck={item}
        drag={deckDragActive && drag ? drag : null}
        onEdit={(id) => {
          if (index !== undefined) setFocusedDeckIndex(index);
          router.push({ pathname: '/deck/[id]/edit', params: { id } });
        }}
        onPress={() => {
          if (index !== undefined) setFocusedDeckIndex(index);
          router.push({ pathname: '/deck/[id]', params: { id: item.id } });
        }}
        isFocused={focusedDeckIndex !== null && index === focusedDeckIndex}
      />
    </SwipeToDeleteRow>
  );

  return (
    <GestureHandlerRootView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={{ height: headerHeights.total, backgroundColor: theme.colors.surface }}>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: headerHeights.content, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
          <Pressable onPress={() => router.push('/search')} style={{ paddingHorizontal: 8 }}>
            <Ionicons name="search-outline" size={theme.fontSize.xxl} color={theme.colors.primary} />
          </Pressable>
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <Text style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('tabs.home')}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          {keyboardShortcutsEnabled && (
            // iPad はタブヘッダー（ナビゲーションヘッダー）の右余白が広く、ホームだけ右寄りに見えるため少し左へ寄せる
            <Pressable onPress={() => setShowShortcutsModal(true)} style={{ paddingLeft: 8, paddingRight: (Platform as any).isPad ? 13 : 8 }}>
              <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
            </Pressable>
          )}
        </View>
      </View>
      {/* 余白タップでフォーカス解除。Pressable を ScrollView/FlatList の祖先に置くと
          押せる要素のない場所からのドラッグでスクロールが始まらない（統計のフリーズの原因）ため、
          固定ヘッダー部とリスト内（フッター）に分けて配置する。 */}
      <View style={{ flex: 1 }}>
        <Pressable style={[styles.fixedHeader, { backgroundColor: theme.colors.background }]} onPress={() => setFocusedDeckIndex(null)}>
          {StatsHeader}
        </Pressable>
        <View style={{ flex: 1 }}>
        {decks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <EmptyState icon="layers-outline" title={t('home.empty')} subtitle={t('home.emptySub')} />
          </View>
        ) : displayedDecks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <EmptyState icon="archive-outline" title={t('home.noActiveDecks')} subtitle={t('home.noActiveDecksSub')} />
          </View>
        ) : (
        // ドラッグ並べ替えが実際に効く「手動＋未ロック」のときだけ DraggableFlatList を使う。
        // それ以外は素の FlatList。DraggableFlatList はリスト全体を RNGH のパンで包むため、
        // 慣性スクロール整定直後のスワイプを取りこぼす（1〜2回空振り）ことがある（カード一覧と同じ対策）。
        deckDragActive ? (
          <DraggableFlatList
            ref={listRef as any}
            // 外側コンテナを flex:1 でビューポート高さに制約する。これが無いと containerSize が
            // コンテンツ全体高さになり、ドラッグ中の端でのオートスクロールが正しく働かない
            // （カード一覧と同じ対策）。
            containerStyle={{ flex: 1 }}
            data={displayedDecks}
            keyExtractor={(item) => item.id}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
              setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false }), 100);
            }}
            // autoscroll をゆっくりにして細かい位置調整を可能にする（パッチで animated:false
            // にしているため既定値だと一気にスクロールしてしまう）。要調整の数値。
            autoscrollSpeed={4}
            contentContainerStyle={styles.listContent}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            automaticallyAdjustsScrollIndicatorInsets={false}
            scrollsToTop={scrollsToTopArmed}
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
            onDragEnd={({ data }) => {
              if (!deckDragActive) return;
              // 「有効」表示中はアーカイブ済みデッキが data に含まれない。
              // 非表示デッキは元の位置に固定したまま、表示中デッキの並びだけを並べ替え結果で埋める
              // （末尾送りを防ぎ、「すべて」に戻したときアーカイブデッキの位置が動かないようにする）。
              const visibleIds = new Set(data.map((d) => d.id));
              let vi = 0;
              const full = sortedDecks.map((d) => (visibleIds.has(d.id) ? data[vi++] : d));
              reorderDecks(full);
              updateDeckSortOrders(db, full.map((d) => d.id));
            }}
            ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedDeckIndex(null)} />}
            renderItem={({ item, drag, getIndex }: RenderItemParams<Deck>) => (
              <ScaleDecorator>
                {renderDeckRow(item, getIndex(), drag)}
              </ScaleDecorator>
            )}
          />
        ) : (
          <FlatList
            ref={listRef}
            style={{ flex: 1 }}
            data={displayedDecks}
            keyExtractor={(item) => item.id}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
              setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false }), 100);
            }}
            contentContainerStyle={styles.listContent}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            automaticallyAdjustsScrollIndicatorInsets={false}
            scrollsToTop={scrollsToTopArmed}
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
            ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedDeckIndex(null)} />}
            renderItem={({ item, index }) => renderDeckRow(item, index, null)}
          />
        ))}
        </View>
        <TouchableOpacity
          style={[styles.fabLeft, { backgroundColor: theme.colors.surface }]}
          onPress={() => router.push('/tags')}
          activeOpacity={0.8}
        >
          <Ionicons name="pricetags-outline" size={24} color={theme.colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: theme.colors.primary }]}
          onPress={() => router.push({ pathname: '/deck/new' })}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={30} color="#FFF" />
        </TouchableOpacity>
      </View>
      <InfoModal
        visible={showDeckListInfo}
        title={t('home.title')}
        message={<InfoContent text={t('home.deckListInfoMessage')} />}
        onClose={() => setShowDeckListInfo(false)}
      />
      <InfoModal
        visible={reorderInfo !== null}
        title={t('card.reorderDisabledTitle')}
        message={reorderInfo ?? lastReorderInfoRef.current}
        onClose={() => setReorderInfo(null)}
      />
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        sections={HOME_SHORTCUT_SECTIONS.map((s) => ({ title: t(s.titleKey), items: s.items }))}
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={t('deck.deleteConfirm', { name: truncate(pendingDeleteDeck?.name ?? '') })}
        onConfirm={handleDeleteConfirm}
        onClose={() => { setShowDeleteModal(false); setPendingDeleteDeck(null); }}
      />
      <ArchivePill archived={archivePill} />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fixedHeader: { paddingHorizontal: 16, paddingTop: 16 },
  statsHeader: { paddingTop: 0, paddingBottom: 8, gap: 24 },
  statsRow: { flexDirection: 'row', gap: 4, marginHorizontal: -2 },
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
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontWeight: '700' },
  sectionTitleCol: { flexDirection: 'column', gap: 2, flex: 1 },
  // alignItems: 'center' は必須。既定の stretch だと、手動時に出る背の高いロックアイコン
  // （paddingVertical が大きい）に合わせてソートチップが縦に引き伸ばされ、中身が上寄りになる。
  sortButtons: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  sortBtn: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  listContent: { padding: 16, gap: 8, paddingBottom: 96 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  card: {
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    ...SHADOW.card,
  },
  cardContent: { flex: 1 },
  deckIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  deckName: { fontWeight: '600', marginBottom: 4 },
  deckDesc: { marginBottom: 4 },
  cardActions: { flexDirection: 'row', gap: 8, marginLeft: 12, alignItems: 'center' },
  iconBtn: { padding: 4 },
  countBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 28,
    alignItems: 'center',
  },
  countBadgeText: { fontWeight: '700', color: '#FFF' },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  fabLeft: {
    position: 'absolute',
    left: 24,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
});
