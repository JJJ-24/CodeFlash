import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { SwipeToDeleteRow } from '@/components/SwipeToDeleteRow';
import { EmptyState } from '@/components/EmptyState';
import { HiddenKeyboardInput } from '@/components/HiddenKeyboardInput';
import { InfoModal } from '@/components/InfoModal';
import { InfoContent } from '@/components/InfoContent';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { useListNavigation } from '@/hooks/useListNavigation';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW, TAG_PRESET_COLORS as PRESET_COLORS } from '@/lib/theme';
import { deleteTag, deleteTagsBulk, getAllTags, updateTagSortOrders, updateTagsColor } from '@/lib/database/tags';
import { useSettingsStore, type DeckSortOrder } from '@/store/settings';
import { useTagStore } from '@/store/tags';
import type { TagWithCount } from '@/store/tags';

const TAG_SHORTCUTS = [
  { key: 'J / K',  descKey: 'shortcut.focusNextPrev' },
  { key: 'Return', descKey: 'shortcut.openFocused' },
  { key: 'P',      descKey: 'shortcut.editFocused' },
  { key: 'D',      descKey: 'shortcut.deleteFocused' },
  { key: 'N',      descKey: 'shortcut.new' },
  { key: 'S',      descKey: 'shortcut.toggleSelect' },
  { key: 'M',      descKey: 'shortcut.cycleSort' },
  { key: 'B',      descKey: 'shortcut.back' },
];

const TAG_SELECTION_SHORTCUTS = [
  { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
  { key: 'Space', descKey: 'shortcut.toggleCheck' },
  { key: 'A',     descKey: 'shortcut.selectAll' },
  { key: 'C',     descKey: 'shortcut.changeColorSelected' },
  { key: 'D',     descKey: 'shortcut.deleteSelectedTags' },
  { key: 'S',     descKey: 'shortcut.exitSelect' },
];

export default function TagsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const initialTopInsetRef = useRef(insets.top);
  const lastFocusTimeRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const savedScrollOffsetRef = useRef(0);
  const restorationEndTimeRef = useRef(0);
  const { tags, setTags, reorderTags, removeTag } = useTagStore();
  const { keyboardShortcutsEnabled, tagSortOrder, setTagSortOrder } = useSettingsStore();
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pickedColor, setPickedColor] = useState<string>(PRESET_COLORS[0]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);

  const sortedTags = useMemo(() => {
    if (tagSortOrder === 'name') return [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (tagSortOrder === 'cardCount') return [...tags].sort((a, b) => b.cardCount - a.cardCount);
    return tags;
  }, [tags, tagSortOrder]);

  const { focusedIndex: focusedTagIndex, setFocusedIndex: setFocusedTagIndex, listRef, moveFocus } = useListNavigation(sortedTags, (tag) => tag.id);

  const selectedCardsCount = useMemo(
    () => sortedTags.filter(t => selectedTagIds.has(t.id)).reduce((sum, t) => sum + t.cardCount, 0),
    [sortedTags, selectedTagIds]
  );

  const SORT_OPTIONS: { key: DeckSortOrder; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: 'manual',    icon: 'reorder-three-outline' },
    { key: 'name',      icon: 'text-outline' },
    { key: 'cardCount', icon: 'layers-outline' },
  ];
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showTagListInfo, setShowTagListInfo] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingDeleteTag, setPendingDeleteTag] = useState<TagWithCount | null>(null);

  function enterSelectionMode() {
    setSelectionMode(true);
    setSelectedTagIds(new Set());
    setFocusedTagIndex(null);
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedTagIds(new Set());
    setFocusedTagIndex(null);
  }

  function toggleSelectTag(id: string) {
    setSelectedTagIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedTagIds.size === sortedTags.length) {
      setSelectedTagIds(new Set());
    } else {
      setSelectedTagIds(new Set(sortedTags.map(t => t.id)));
    }
  }

  function confirmDelete(tag: TagWithCount) {
    setPendingDeleteTag(tag);
    setShowDeleteModal(true);
  }

  async function handleDeleteConfirm() {
    if (!pendingDeleteTag) return;
    setShowDeleteModal(false);
    await deleteTag(db, pendingDeleteTag.id);
    removeTag(pendingDeleteTag.id);
    setPendingDeleteTag(null);
  }

  async function handleBulkDelete() {
    if (selectedTagIds.size === 0 || isProcessing) return;
    setIsProcessing(true);
    setShowBulkDeleteModal(false);
    const ids = Array.from(selectedTagIds);
    const idsSet = new Set(ids);
    await deleteTagsBulk(db, ids);
    setTags(tags.filter(t => !idsSet.has(t.id)));
    exitSelectionMode();
    setIsProcessing(false);
  }

  async function handleBulkColorChange() {
    if (selectedTagIds.size === 0 || isProcessing) return;
    setIsProcessing(true);
    setShowColorPicker(false);
    const ids = Array.from(selectedTagIds);
    const idsSet = new Set(ids);
    const color = pickedColor;
    await updateTagsColor(db, ids, color);
    setTags(tags.map(t => idsSet.has(t.id) ? { ...t, color } : t));
    exitSelectionMode();
    setIsProcessing(false);
  }

  useFocusEffect(
    useCallback(() => {
      lastFocusTimeRef.current = Date.now();
      const targetOffset = savedScrollOffsetRef.current;
      restorationEndTimeRef.current = Date.now() + 800;
      let cancelled = false;
      getAllTags(db).then((loadedTags) => {
        if (cancelled) return;
        setTags(loadedTags);
        setTimeout(() => {
          if (!cancelled) (listRef.current as any)?.scrollToOffset({ offset: targetOffset, animated: false });
        }, 50);
      });
      onScreenFocus();
      return () => {
        cancelled = true;
        restorationEndTimeRef.current = 0;
        savedScrollOffsetRef.current = scrollOffsetRef.current;
        onScreenBlur();
      };
    }, [db, onScreenFocus, onScreenBlur])
  );

  return (
    <GestureHandlerRootView style={[styles.flex, { backgroundColor: theme.colors.background }]}>
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
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
            }}
          >
            <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {selectionMode ? t('shortcut.selectMode') : t('tag.title')}
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
            onPress={selectionMode ? exitSelectionMode : enterSelectionMode}
            disabled={!selectionMode && sortedTags.length === 0}
            style={[{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, !selectionMode && sortedTags.length === 0 && { opacity: 0.3 }]}
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

      <HiddenKeyboardInput
        ref={keyboardRef}
        onKeyPress={({ nativeEvent: { key } }) => {
          if (!keyboardShortcutsEnabled) return;
          const k = key.toLowerCase();
          if (selectionMode) {
            if (k === 'j') { moveFocus('next'); }
            else if (k === 'k') { moveFocus('prev'); }
            else if (k === ' ') {
              if (focusedTagIndex !== null && sortedTags[focusedTagIndex]) {
                toggleSelectTag(sortedTags[focusedTagIndex].id);
              }
            } else if (k === 'a') { toggleSelectAll(); }
            else if (k === 'c') {
              if (selectedTagIds.size > 0) { setPickedColor(PRESET_COLORS[0]); setShowColorPicker(true); }
            } else if (k === 'd') {
              if (selectedTagIds.size > 0) setShowBulkDeleteModal(true);
            } else if (k === 's') { exitSelectionMode(); }
          } else {
            if (k === 'j') { moveFocus('next'); }
            else if (k === 'k') { moveFocus('prev'); }
            else if (k === 'p') {
              if (focusedTagIndex !== null && sortedTags[focusedTagIndex]) {
                router.push(`/tags/${sortedTags[focusedTagIndex].id}/edit`);
              }
            } else if (k === 'd') {
              if (focusedTagIndex !== null && sortedTags[focusedTagIndex]) {
                confirmDelete(sortedTags[focusedTagIndex]);
              }
            } else if (k === 'n') {
              router.push('/tags/new');
            } else if (k === 'm') {
              const idx = SORT_OPTIONS.findIndex(o => o.key === tagSortOrder);
              setTagSortOrder(SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length].key);
            } else if (k === 's') {
              enterSelectionMode();
            } else if (k === 'b') {
              router.back();
            }
          }
        }}
        onSubmitEditing={() => {
          if (!keyboardShortcutsEnabled || selectionMode) return;
          if (focusedTagIndex !== null && sortedTags[focusedTagIndex]) {
            router.push({ pathname: '/tags/[tagId]/cards', params: { tagId: sortedTags[focusedTagIndex].id } });
          }
        }}
        onBlur={onInputBlur}
      />

      <Pressable style={{ flex: 1 }} onPress={() => setFocusedTagIndex(null)}>
      <View style={[styles.sectionRow, { paddingHorizontal: 16, paddingTop: 16, backgroundColor: theme.colors.background }]}>
        <View style={styles.sectionTitleCol}>
          {selectionMode ? (
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('tag.selectHint')}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('tag.tagListTitle')}
              </Text>
              <Pressable onPress={() => setShowTagListInfo(true)} hitSlop={8} accessibilityLabel={t('tag.tagListInfoLabel')}>
                <Ionicons name="information-circle-outline" size={Math.max(theme.fontSize.lg, 20)} color={theme.colors.textTertiary} />
              </Pressable>
            </View>
          )}
          {!selectionMode && (
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t(`home.sortDesc${tagSortOrder.charAt(0).toUpperCase()}${tagSortOrder.slice(1)}`)}
            </Text>
          )}
        </View>
        {!selectionMode && (
          <View style={styles.sortButtons}>
            {SORT_OPTIONS.map(({ key, icon }) => {
              const active = tagSortOrder === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setTagSortOrder(key)}
                  style={[
                    styles.sortBtn,
                    { borderColor: active ? theme.colors.primary : theme.colors.buttonBorder, paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
                    active && { backgroundColor: theme.colors.primary },
                  ]}
                >
                  <Ionicons name={icon} size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)} color={active ? theme.colors.primaryText : theme.colors.textSecondary} />
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {tags.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.colors.background }]}>
          <EmptyState icon="pricetags-outline" title={t('tag.empty')} subtitle={t('tag.emptySub')} />
        </View>
      ) : (
        <DraggableFlatList
          ref={listRef as any}
          style={{ backgroundColor: theme.colors.background }}
          // 外側コンテナを flex:1 でビューポート高さに制約する。これが無いとコンテナが
          // コンテンツ高さになり、下方向ドラッグ時の autoscroll（containerSize 基準）が
          // 発火しない。※ style ではなく containerStyle に付けること（style は内側の
          // FlatList に渡り、高さ未定義の外側コンテナ内で flex:1 が 0 高さに潰れて
          // リストが描画されなくなる）。
          containerStyle={{ flex: 1 }}
          // autoscroll をゆっくりにして細かい位置調整を可能にする（パッチで animated:false
          // にしているため既定値だと一気にスクロールしてしまう）。要調整の数値。
          autoscrollSpeed={5}
          data={sortedTags}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, selectionMode && { paddingBottom: 160 }]}
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
              (listRef.current as any)?.scrollToOffset({ offset: savedScrollOffsetRef.current, animated: false });
            }
          }}
          onScrollBeginDrag={() => { restorationEndTimeRef.current = 0; }}
          onDragEnd={({ data }) => {
            if (selectionMode) return;
            reorderTags(data);
            updateTagSortOrders(db, data.map((t) => t.id));
          }}
          ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedTagIndex(null)} />}
          renderItem={({ item, drag, getIndex }: RenderItemParams<TagWithCount>) => {
            const isFocused = focusedTagIndex !== null && getIndex() === focusedTagIndex;
            const isSelected = selectedTagIds.has(item.id);
            return (
              <ScaleDecorator>
                {/* 手動並び替え・選択モード以外で左スワイプ削除を有効化 */}
                <SwipeToDeleteRow
                  enabled={!selectionMode && tagSortOrder !== 'manual'}
                  onDelete={() => confirmDelete(item)}
                >
                  <Pressable
                    style={[
                      styles.tagItem,
                      { backgroundColor: theme.colors.surface },
                      isFocused && !selectionMode && { borderWidth: 2, borderColor: theme.colors.primary },
                      isSelected && { borderWidth: 2, borderColor: theme.colors.primary },
                      isFocused && selectionMode && { borderWidth: 2, borderColor: '#F57C00' },
                    ]}
                    onPress={() => {
                      const idx = getIndex();
                      if (selectionMode) {
                        if (idx !== undefined) setFocusedTagIndex(idx);
                        toggleSelectTag(item.id);
                        return;
                      }
                      if (idx !== undefined) setFocusedTagIndex(idx);
                      router.push({ pathname: '/tags/[tagId]/cards', params: { tagId: item.id } });
                    }}
                    onLongPress={!selectionMode && tagSortOrder === 'manual' ? drag : undefined}
                  >
                    {selectionMode && (
                      <Ionicons
                        name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={isSelected ? theme.colors.primary : theme.colors.textTertiary}
                      />
                    )}
                    <View style={[styles.colorDot, { backgroundColor: item.color }]} />
                    <Text numberOfLines={1} style={[styles.tagName, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{item.name}</Text>
                    <View style={[styles.countBadge, { backgroundColor: theme.dark ? '#4B5563' : '#8B949E' }]}>
                      <Text style={[styles.countBadgeText, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{item.cardCount}</Text>
                    </View>
                    {!selectionMode && (
                      <>
                        <Pressable onPress={() => { const idx = getIndex(); if (idx !== undefined) setFocusedTagIndex(idx); router.push(`/tags/${item.id}/edit`); }} hitSlop={8} style={styles.editBtn}>
                          <Ionicons name="pencil-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
                        </Pressable>
                        <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.textTertiary} />
                      </>
                    )}
                  </Pressable>
                </SwipeToDeleteRow>
              </ScaleDecorator>
            );
          }}
        />
      )}

      {/* FAB: 戻る */}
      {!selectionMode && (
        <Pressable
          style={[styles.fab, { left: 20, backgroundColor: theme.colors.primary }]}
          onPress={() => { if (Date.now() - lastFocusTimeRef.current >= 350) router.back(); }}
        >
          <Ionicons name="chevron-back" size={28} color="#FFF" />
        </Pressable>
      )}

      {/* FAB: 新規タグ作成 */}
      {!selectionMode && (
        <Pressable
          style={[styles.fab, { right: 20, backgroundColor: theme.colors.primary }]}
          onPress={() => router.push('/tags/new')}
        >
          <Ionicons name="add" size={28} color="#FFF" />
        </Pressable>
      )}
      </Pressable>

      {/* 選択モードバー */}
      {selectionMode && (
        <View style={[styles.selectionBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
          <Pressable
            onPress={toggleSelectAll}
            style={[styles.iconBtn, { backgroundColor: theme.colors.primary }]}
          >
            <Ionicons
              name={selectedTagIds.size > 0 && selectedTagIds.size === sortedTags.length ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={22}
              color="#FFF"
            />
          </Pressable>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('tag.selectedCount', { count: selectedTagIds.size })}
          </Text>
          <View style={styles.selectionActions}>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: theme.colors.primary }, (selectedTagIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={() => { if (selectedTagIds.size > 0 && !isProcessing) { setPickedColor(PRESET_COLORS[0]); setShowColorPicker(true); } }}
              disabled={selectedTagIds.size === 0 || isProcessing}
            >
              <Ionicons name="color-palette-outline" size={22} color="#FFF" />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, { backgroundColor: '#C62828' }, (selectedTagIds.size === 0 || isProcessing) && { opacity: 0.4 }]}
              onPress={() => { if (selectedTagIds.size > 0 && !isProcessing) setShowBulkDeleteModal(true); }}
              disabled={selectedTagIds.size === 0 || isProcessing}
            >
              <Ionicons name="trash-outline" size={22} color="#FFF" />
            </Pressable>
          </View>
        </View>
      )}

      <InfoModal
        visible={showTagListInfo}
        title={t('tag.tagListInfoTitle')}
        message={<InfoContent text={t('tag.tagListInfoMessage')} />}
        onClose={() => setShowTagListInfo(false)}
      />
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        sections={selectionMode
          ? [{ title: t('shortcut.selectMode'), items: TAG_SELECTION_SHORTCUTS }]
          : [{ title: t('shortcut.normalMode'), items: TAG_SHORTCUTS }]
        }
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={t('tag.deleteConfirm', { name: pendingDeleteTag ? (pendingDeleteTag.name.length > 20 ? pendingDeleteTag.name.slice(0, 20) + '…' : pendingDeleteTag.name) : '' })}
        onConfirm={handleDeleteConfirm}
        onClose={() => { setShowDeleteModal(false); setPendingDeleteTag(null); }}
      />
      <ConfirmDeleteModal
        visible={showBulkDeleteModal}
        message={t('tag.deleteSelectedConfirm', { count: selectedTagIds.size, cardCount: selectedCardsCount })}
        onConfirm={handleBulkDelete}
        onClose={() => setShowBulkDeleteModal(false)}
      />

      {/* カラーピッカーモーダル */}
      <Modal
        visible={showColorPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowColorPicker(false)}
      >
        <Pressable style={styles.colorPickerOverlay} onPress={() => setShowColorPicker(false)}>
          <Pressable style={[styles.colorPickerSheet, { backgroundColor: theme.colors.surface }, (Platform as any).isPad && styles.colorPickerSheetPad]} onPress={() => {}}>
            <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text, marginBottom: 16 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('tag.changeColor')}
            </Text>
            <View style={styles.colorGrid}>
              {PRESET_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorCell, { backgroundColor: c }, pickedColor === c && styles.colorCellSelected]}
                  onPress={() => setPickedColor(c)}
                >
                  {pickedColor === c && <Ionicons name="checkmark-sharp" size={18} color="#FFF" />}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.colorPickerBtn, { backgroundColor: theme.colors.primary }]}
              onPress={handleBulkColorChange}
            >
              <Text style={{ color: '#FFF', fontWeight: '600', fontSize: theme.fontSize.md }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('common.apply')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 16, gap: 8, paddingBottom: 96 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  sectionTitleCol: { flexDirection: 'column', gap: 2, flex: 1 },
  sectionTitle: { fontWeight: '700' },
  sortButtons: { flexDirection: 'row', gap: 6 },
  sortBtn: { borderRadius: 6, borderWidth: 1, paddingVertical: 4 },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderRadius: 12,
    ...SHADOW.subtle,
  },
  colorDot: { width: 16, height: 16, borderRadius: 8 },
  tagName: { flex: 1, fontWeight: '500' },
  countBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 28,
    alignItems: 'center',
  },
  countBadgeText: { fontWeight: '700', color: '#FFF' },
  editBtn: { padding: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  colorPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  colorPickerSheet: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
  },
  // iPad は12色が横一列に収まるちょうどの幅にする
  // （セル44×12 + ガタ10×11 + 余白24×2 = 686。狭いスプリットビューでは maxWidth で抑え、その時は折り返す）
  colorPickerSheetPad: {
    width: 686,
    maxWidth: '100%',
    alignSelf: 'center',
  },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  colorCell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCellSelected: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  colorPickerBtn: {
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
});
