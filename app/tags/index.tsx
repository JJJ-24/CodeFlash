import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { HiddenKeyboardInput } from '@/components/HiddenKeyboardInput';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { useListNavigation } from '@/hooks/useListNavigation';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW } from '@/lib/theme';
import { deleteTag, getAllTags, updateTagSortOrders } from '@/lib/database/tags';
import { useSettingsStore, type DeckSortOrder } from '@/store/settings';
import { useTagStore } from '@/store/tags';
import type { TagWithCount } from '@/store/tags';

const TAG_SHORTCUTS = [
  { key: 'J / K',   descKey: 'shortcut.focusNextPrev' },
  { key: 'Return', descKey: 'shortcut.openFocused' },
  { key: 'P',     descKey: 'shortcut.editFocused' },
  { key: 'D',     descKey: 'shortcut.deleteFocused' },
  { key: 'N',     descKey: 'shortcut.new' },
  { key: 'M',     descKey: 'shortcut.cycleSort' },
  { key: 'B',     descKey: 'shortcut.back' },
];

export default function TagsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const initialTopInsetRef = useRef(insets.top);
  const lastFocusTimeRef = useRef(0);
  const { tags, setTags, reorderTags, removeTag } = useTagStore();
  const { keyboardShortcutsEnabled, tagSortOrder, setTagSortOrder } = useSettingsStore();
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();

  const sortedTags = useMemo(() => {
    if (tagSortOrder === 'name') return [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (tagSortOrder === 'cardCount') return [...tags].sort((a, b) => b.cardCount - a.cardCount);
    return tags;
  }, [tags, tagSortOrder]);

  const { focusedIndex: focusedTagIndex, setFocusedIndex: setFocusedTagIndex, listRef, moveFocus } = useListNavigation(sortedTags, (tag) => tag.id);

  const SORT_OPTIONS: { key: DeckSortOrder; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: 'manual',    icon: 'reorder-three-outline' },
    { key: 'name',      icon: 'text-outline' },
    { key: 'cardCount', icon: 'layers-outline' },
  ];
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  function confirmDelete(tag: TagWithCount) {
    const name = tag.name.length > 20 ? tag.name.slice(0, 20) + '…' : tag.name;
    Alert.alert(t('tag.delete'), t('tag.deleteConfirm', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteTag(db, tag.id);
          removeTag(tag.id);
        },
      },
    ]);
  }

  useFocusEffect(
    useCallback(() => {
      lastFocusTimeRef.current = Date.now();
      getAllTags(db).then(setTags);
      onScreenFocus();
      return () => { onScreenBlur(); };
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
              {t('tag.title')}
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
          <View style={{ width: 36 }} />
        </View>
      </View>

      <HiddenKeyboardInput
        ref={keyboardRef}
        onKeyPress={({ nativeEvent: { key } }) => {
          if (!keyboardShortcutsEnabled) return;
          const k = key.toLowerCase();
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
          } else if (k === 'b') {
            router.back();
          }
        }}
        onSubmitEditing={() => {
          if (!keyboardShortcutsEnabled) return;
          if (focusedTagIndex !== null && sortedTags[focusedTagIndex]) {
            router.push({ pathname: '/tags/[tagId]/cards', params: { tagId: sortedTags[focusedTagIndex].id } });
          }
        }}
        onBlur={onInputBlur}
      />

      <Pressable style={{ flex: 1 }} onPress={() => setFocusedTagIndex(null)}>
      <View style={[styles.sectionRow, { paddingHorizontal: 16, paddingTop: 16, backgroundColor: theme.colors.background }]}>
        <View style={styles.sectionTitleCol}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('tag.tagListTitle')}
          </Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t(`home.sortDesc${tagSortOrder.charAt(0).toUpperCase()}${tagSortOrder.slice(1)}`)}
          </Text>
        </View>
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
                <Ionicons name={icon} size={theme.fontSize.xl} color={active ? theme.colors.primaryText : theme.colors.textSecondary} />
              </Pressable>
            );
          })}
        </View>
      </View>

      {tags.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.colors.background }]}>
          <EmptyState icon="pricetags-outline" title={t('tag.empty')} subtitle={t('tag.emptySub')} />
        </View>
      ) : (
        <DraggableFlatList
          ref={listRef as any}
          style={{ backgroundColor: theme.colors.background }}
          data={sortedTags}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onDragEnd={({ data }) => {
            reorderTags(data);
            updateTagSortOrders(db, data.map((t) => t.id));
          }}
          ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedTagIndex(null)} />}
          renderItem={({ item, drag, getIndex }: RenderItemParams<TagWithCount>) => {
            const isFocused = focusedTagIndex !== null && getIndex() === focusedTagIndex;
            return (
              <ScaleDecorator>
                <Pressable
                  style={[
                    styles.tagItem,
                    { backgroundColor: theme.colors.surface },
                    isFocused && { borderWidth: 2, borderColor: theme.colors.primary },
                  ]}
                  onPress={() => {
                    const idx = getIndex();
                    if (idx !== undefined) setFocusedTagIndex(idx);
                    router.push({ pathname: '/tags/[tagId]/cards', params: { tagId: item.id } });
                  }}
                  onLongPress={tagSortOrder === 'manual' ? drag : undefined}
                >
                  <View style={[styles.colorDot, { backgroundColor: item.color }]} />
                  <Text numberOfLines={1} style={[styles.tagName, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{item.name}</Text>
                  <View style={[styles.countBadge, { backgroundColor: theme.dark ? '#4B5563' : '#8B949E' }]}>
                    <Text style={[styles.countBadgeText, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{item.cardCount}</Text>
                  </View>
                  <Pressable onPress={() => router.push(`/tags/${item.id}/edit`)} hitSlop={8} style={styles.iconBtn}>
                    <Ionicons name="pencil-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
                  </Pressable>
                  <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.textTertiary} />
                </Pressable>
              </ScaleDecorator>
            );
          }}
        />
      )}

      {/* FAB: 戻る */}
      <Pressable
        style={[styles.fab, { left: 20, backgroundColor: theme.colors.primary }]}
        onPress={() => { if (Date.now() - lastFocusTimeRef.current >= 350) router.back(); }}
      >
        <Ionicons name="chevron-back" size={28} color="#FFF" />
      </Pressable>

      {/* FAB: 新規タグ作成 */}
      <Pressable
        style={[styles.fab, { right: 20, backgroundColor: theme.colors.primary }]}
        onPress={() => router.push('/tags/new')}
      >
        <Ionicons name="add" size={28} color="#FFF" />
      </Pressable>
      </Pressable>

      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        shortcuts={TAG_SHORTCUTS}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 16, gap: 12, paddingBottom: 96 },
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
  iconBtn: { padding: 4 },
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
});
