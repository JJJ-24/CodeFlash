import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { useListNavigation } from '@/hooks/useListNavigation';
import { useTheme } from '@/lib/theme';
import { deleteTag, getAllTags, updateTagSortOrders } from '@/lib/database/tags';
import { useSettingsStore } from '@/store/settings';
import { useTagStore } from '@/store/tags';
import type { TagWithCount } from '@/store/tags';

const TAG_SHORTCUTS = [
  { key: 'T / Y',   descKey: 'settings.shortcutFocusNextPrev' },
  { key: 'Space', descKey: 'settings.shortcutOpenTag' },
  { key: 'P',     descKey: 'settings.shortcutEditTag' },
  { key: 'D',     descKey: 'settings.shortcutDeleteTag' },
  { key: 'N',     descKey: 'settings.shortcutNewTag' },
  { key: 'B',     descKey: 'settings.shortcutBack' },
];

export default function TagsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { tags, setTags, reorderTags, removeTag } = useTagStore();
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();
  const { focusedIndex: focusedTagIndex, listRef, moveFocus } = useListNavigation(tags);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  function confirmDelete(tag: TagWithCount) {
    Alert.alert(t('tag.delete'), t('tag.deleteConfirm'), [
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
      getAllTags(db).then(setTags);
      onScreenFocus();
      return () => { onScreenBlur(); };
    }, [db, onScreenFocus, onScreenBlur])
  );

  return (
    <GestureHandlerRootView style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable
              onPress={keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text }}>
                {t('tag.title')}
              </Text>
              {keyboardShortcutsEnabled && (
                <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
              )}
            </Pressable>
          ),
        }}
      />

      <TextInput
        ref={keyboardRef}
        style={styles.hiddenKeyboardInput}
        caretHidden
        keyboardType="ascii-capable"
        showSoftInputOnFocus={false}
        disableKeyboardShortcuts={true}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        onKeyPress={({ nativeEvent: { key } }) => {
          const k = key.toLowerCase();
          if (k === 't') { moveFocus('next'); }
          else if (k === 'y') { moveFocus('prev'); }
          else if (key === ' ') {
            if (focusedTagIndex !== null && tags[focusedTagIndex]) {
              router.push({ pathname: '/tags/[tagId]/cards', params: { tagId: tags[focusedTagIndex].id } });
            }
          } else if (k === 'p') {
            if (focusedTagIndex !== null && tags[focusedTagIndex]) {
              router.push(`/tags/${tags[focusedTagIndex].id}/edit`);
            }
          } else if (k === 'd') {
            if (focusedTagIndex !== null && tags[focusedTagIndex]) {
              confirmDelete(tags[focusedTagIndex]);
            }
          } else if (k === 'n') {
            router.push('/tags/new');
          } else if (k === 'b') {
            router.back();
          }
        }}
        onBlur={onInputBlur}
      />

      {tags.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.colors.background }]}>
          <EmptyState icon="pricetags-outline" title={t('tag.empty')} subtitle={t('tag.emptySub')} />
        </View>
      ) : (
        <DraggableFlatList
          ref={listRef as any}
          style={{ backgroundColor: theme.colors.background }}
          data={tags}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onDragEnd={({ data }) => {
            reorderTags(data);
            updateTagSortOrders(db, data.map((t) => t.id));
          }}
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
                  onPress={() => router.push({ pathname: '/tags/[tagId]/cards', params: { tagId: item.id } })}
                  onLongPress={drag}
                >
                  <View style={[styles.colorDot, { backgroundColor: item.color }]} />
                  <Text numberOfLines={1} style={[styles.tagName, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>{item.name}</Text>
                  <View style={[styles.countBadge, { backgroundColor: theme.dark ? '#4B5563' : '#8B949E' }]}>
                    <Text style={[styles.countBadgeText, { fontSize: theme.fontSize.sm }]}>{item.cardCount}</Text>
                  </View>
                  <Pressable onPress={() => router.push(`/tags/${item.id}/edit`)} hitSlop={8} style={styles.iconBtn}>
                    <Ionicons name="pencil-outline" size={18} color={theme.colors.primary} />
                  </Pressable>
                  <Pressable onPress={() => confirmDelete(item)} hitSlop={8} style={styles.iconBtn}>
                    <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
                  </Pressable>
                </Pressable>
              </ScaleDecorator>
            );
          }}
        />
      )}

      {/* FAB: 戻る */}
      <Pressable style={[styles.fabBack, { backgroundColor: theme.colors.primary }]} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={28} color="#FFF" />
      </Pressable>

      {/* FAB */}
      <Pressable
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => router.push('/tags/new')}
      >
        <Ionicons name="add" size={28} color="#FFF" />
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
  hiddenKeyboardInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  list: { padding: 16, gap: 12, paddingBottom: 96 },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
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
  fabBack: {
    position: 'absolute',
    left: 20,
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
