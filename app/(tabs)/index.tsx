import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { getDefaultHeaderHeight } from '@react-navigation/elements';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { setStatusBarHidden } from 'expo-status-bar';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
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
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { InfoModal } from '@/components/InfoModal';
import { InfoContent } from '@/components/InfoContent';
import { SwipeToDeleteRow } from '@/components/SwipeToDeleteRow';
import { EmptyState } from '@/components/EmptyState';
import { HiddenKeyboardInput } from '@/components/HiddenKeyboardInput';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { resolveDeckIconColors } from '@/lib/deckIconColors';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW, fontSizeForDigits } from '@/lib/theme';
import { deleteDeck, getAllDecks, setDeckArchived, updateDeckSortOrders } from '@/lib/database/decks';
import { sortDecks } from '@/lib/sortDecks';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { useListNavigation } from '@/hooks/useListNavigation';
import { useDeckStore } from '@/store/decks';
import { useSyncStore } from '@/store/sync';
import { useSettingsStore, type DeckSortOrder } from '@/store/settings';
import type { Deck } from '@/types';

const HOME_SHORTCUTS = [
  { key: 'J / K',   descKey: 'shortcut.focusNextPrev' },
  { key: 'Return', descKey: 'shortcut.openFocused' },
  { key: 'P',     descKey: 'shortcut.editFocused' },
  { key: 'D',     descKey: 'shortcut.deleteFocused' },
  { key: 'N',     descKey: 'shortcut.new' },
  { key: 'M',     descKey: 'shortcut.cycleSort' },
  { key: 'F',     descKey: 'shortcut.search' },
  { key: 'T',     descKey: 'shortcut.tags' },
  { key: ', / .', descKey: 'shortcut.tabNextPrev' },
];

function truncate(str: string, max = 20): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function computeHeaderHeights(topInset: number, frame: { width: number; height: number }) {
  // React Navigation のヘッダーと同じ算出：total（ステータスバー込み）から
  // ステータスバー（insets.top）を引いた残りがコンテンツ行の高さ。
  // 下端基準でこの高さの行を置き、中身を中央寄せするとタブヘッダーのタイトル/アイコン位置と一致する。
  const total = getDefaultHeaderHeight(frame, false, topInset);
  return { total, content: total - topInset };
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
  const { decks, setDecks, removeDeck, reorderDecks, updateDeck } = useDeckStore();
  const { deckSortOrder, setDeckSortOrder, keyboardShortcutsEnabled, lastHomeFilter, setLastHomeFilter } = useSettingsStore();
  const { width } = useWindowDimensions();
  // 学習/統計タブの1ブロック実幅に一致させる（コンテナ余白16・行 marginHorizontal:-2・各ブロック margin:2・gap:4 の4列構成）
  const blockWidth = (width - 56) / 4;
  const filterBlockMinHeight = 32 + Math.ceil(fontSizeForDigits(theme, 1) * 1.35) + 2 + Math.ceil(theme.fontSize.xs * 1.35);
  // ホームのデッキ絞り込み（active=有効デッキのみ / all=アーカイブ含む全デッキ）。最後の選択を永続化。
  const selectedFilter = lastHomeFilter;
  const setSelectedFilter = setLastHomeFilter;
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showDeckListInfo, setShowDeckListInfo] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingDeleteDeck, setPendingDeleteDeck] = useState<Deck | null>(null);
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();
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
      // WKWebView がネイティブクリーンアップ時に iOS ステータスバー状態を上書きするため、
      // フォーカス直後から複数タイミングで復元して確実に打ち勝つ。
      // insets.top 監視ではノッチ/Dynamic Island iPhone でステータスバーを隠しても
      // insets.top が変化しないため機能しない。
      setStatusBarHidden(false, 'none');
      const sbTid1 = setTimeout(() => { if (isFocusedRef.current) setStatusBarHidden(false, 'none'); }, 200);
      const sbTid2 = setTimeout(() => { if (isFocusedRef.current) setStatusBarHidden(false, 'none'); }, 550);
      const targetOffset = savedScrollOffsetRef.current;
      restorationEndTimeRef.current = Date.now() + 800;
      const tid1 = setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
      }, 50);
      onScreenFocus();
      return () => {
        isFocusedRef.current = false;
        clearTimeout(sbTid1);
        clearTimeout(sbTid2);
        clearTimeout(tid1);
        restorationEndTimeRef.current = 0;
        savedScrollOffsetRef.current = scrollOffsetRef.current;
        onScreenBlur();
      };
    }, [onScreenFocus, onScreenBlur])
  );

  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  // safe area / frame に追従させる（useRef でマウント時固定すると初期 inset 未解決の値を掴み、
  // タブヘッダーと高さがズレる原因になる）
  const headerHeights = useMemo(() => computeHeaderHeights(insets.top, frame), [insets.top, frame]);

  async function handleDelete(id: string) {
    await deleteDeck(db, id);
    removeDeck(id);
  }

  async function toggleDeckArchive(deck: Deck) {
    const next = !deck.archived;
    await setDeckArchived(db, deck.id, next);
    updateDeck({ ...deck, archived: next });
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

  function cycleSortOrder() {
    const idx = SORT_OPTIONS.findIndex((o) => o.key === deckSortOrder);
    const next = SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length];
    setDeckSortOrder(next.key);
  }

  const { focusedIndex: focusedDeckIndex, setFocusedIndex: setFocusedDeckIndex, listRef, moveFocus: moveDeckFocus } = useListNavigation(displayedDecks, (deck) => deck.id);

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
            {t(`home.sortDesc${deckSortOrder.charAt(0).toUpperCase()}${deckSortOrder.slice(1)}`)}
          </Text>
        </View>
        <View style={styles.sortButtons}>
          {SORT_OPTIONS.map(({ key, icon }) => {
            const active = deckSortOrder === key;
            return (
              <Pressable
                key={key}
                onPress={() => setDeckSortOrder(key)}
                style={[
                  styles.sortBtn,
                  { borderColor: active ? theme.colors.primary : theme.colors.buttonBorder, paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
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

  const handleKeyPress = useCallback(({ nativeEvent: { key } }: { nativeEvent: { key: string } }) => {
    if (!keyboardShortcutsEnabled) return;
    const k = key.toLowerCase();
    if (k === 'm') {
      cycleSortOrder();
    } else if (k === 'j') {
      moveDeckFocus('next');
    } else if (k === 'k') {
      moveDeckFocus('prev');
    } else if (k === 'p') {
      if (focusedDeckIndex !== null && displayedDecks[focusedDeckIndex]) {
        router.push({ pathname: '/deck/[id]/edit', params: { id: displayedDecks[focusedDeckIndex].id } });
      }
    } else if (k === 'd') {
      if (focusedDeckIndex !== null && displayedDecks[focusedDeckIndex]) {
        setPendingDeleteDeck(displayedDecks[focusedDeckIndex]);
        setShowDeleteModal(true);
      }
    } else if (k === 'n') {
      router.push({ pathname: '/deck/new' });
    } else if (k === 'f') {
      router.push('/search');
    } else if (k === 't') {
      router.push('/tags');
    } else if (key === '.') {
      router.navigate('/(tabs)/study');
    } else if (key === ',') {
      router.navigate('/(tabs)/settings');
    }
  }, [keyboardShortcutsEnabled, cycleSortOrder, moveDeckFocus, focusedDeckIndex, displayedDecks, router, t, handleDelete]);

  const handleSubmitEditing = useCallback(() => {
    if (!keyboardShortcutsEnabled) return;
    if (focusedDeckIndex !== null && displayedDecks[focusedDeckIndex]) {
      router.push({ pathname: '/deck/[id]', params: { id: displayedDecks[focusedDeckIndex].id } });
    }
  }, [keyboardShortcutsEnabled, focusedDeckIndex, displayedDecks, router]);

  return (
    <GestureHandlerRootView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <HiddenKeyboardInput
        ref={keyboardRef}
        onKeyPress={handleKeyPress}
        onSubmitEditing={handleSubmitEditing}
        onBlur={onInputBlur}
      />
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
      <Pressable style={{ flex: 1 }} onPress={() => setFocusedDeckIndex(null)}>
        <View style={[styles.fixedHeader, { backgroundColor: theme.colors.background }]}>
          {StatsHeader}
        </View>
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
          <DraggableFlatList
            ref={listRef}
            data={displayedDecks}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            automaticallyAdjustsScrollIndicatorInsets={false}
            scrollsToTop={false}
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
              if (deckSortOrder !== 'manual') return;
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
                {/* 手動並び替えモード以外で左スワイプ削除を有効化（手動時はドラッグ優先で無効） */}
                <SwipeToDeleteRow
                  enabled={deckSortOrder !== 'manual'}
                  onDelete={() => { setPendingDeleteDeck(item); setShowDeleteModal(true); }}
                  onArchive={() => toggleDeckArchive(item)}
                  archived={item.archived}
                >
                  <DeckCard
                    deck={item}
                    drag={deckSortOrder === 'manual' ? drag : null}
                    onEdit={(id) => {
                      const idx = getIndex();
                      if (idx !== undefined) setFocusedDeckIndex(idx);
                      router.push({ pathname: '/deck/[id]/edit', params: { id } });
                    }}
                    onPress={() => {
                      const idx = getIndex();
                      if (idx !== undefined) setFocusedDeckIndex(idx);
                      router.push({ pathname: '/deck/[id]', params: { id: item.id } });
                    }}
                    isFocused={focusedDeckIndex !== null && getIndex() === focusedDeckIndex}
                  />
                </SwipeToDeleteRow>
              </ScaleDecorator>
            )}
          />
        )}
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
      </Pressable>
      <InfoModal
        visible={showDeckListInfo}
        title={t('home.deckListInfoTitle')}
        message={<InfoContent text={t('home.deckListInfoMessage')} />}
        onClose={() => setShowDeckListInfo(false)}
      />
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        shortcuts={HOME_SHORTCUTS}
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={t('deck.deleteConfirm', { name: truncate(pendingDeleteDeck?.name ?? '') })}
        onConfirm={handleDeleteConfirm}
        onClose={() => { setShowDeleteModal(false); setPendingDeleteDeck(null); }}
      />
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
  sortButtons: { flexDirection: 'row', gap: 6 },
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
