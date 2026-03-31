import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useTheme } from '@/lib/theme';
import { deleteTag, getAllTags, updateTagSortOrders } from '@/lib/database/tags';
import { useTagStore } from '@/store/tags';
import type { Tag } from '@/types';

type TagWithCount = Tag & { cardCount: number };

export default function TagsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { tags, setTags, reorderTags, removeTag } = useTagStore();

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

  const TAG_LIMIT = 12;
  const isAtLimit = tags.length >= TAG_LIMIT;

  useFocusEffect(
    useCallback(() => {
      getAllTags(db).then(setTags);
    }, [db])
  );

  return (
    <GestureHandlerRootView style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen
        options={{
          title: t('tag.title'),
          headerRight: () => (
            <Pressable
              onPress={() => { router.dismissAll(); router.navigate('/(tabs)/'); }}
              style={{ width: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="home-outline" size={22} color={theme.colors.primary} />
            </Pressable>
          ),
        }}
      />

      {tags.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.colors.background }]}>
          <Ionicons name="pricetags-outline" size={64} color={theme.colors.iconSubtle} />
          <Text style={[styles.emptyText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
            {t('tag.empty')}
          </Text>
          <Text style={[styles.emptySub, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}>
            {t('tag.emptySub')}
          </Text>
        </View>
      ) : (
        <DraggableFlatList
          style={{ backgroundColor: theme.colors.background }}
          data={tags}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onDragEnd={({ data }) => {
            reorderTags(data);
            updateTagSortOrders(db, data.map((t) => t.id));
          }}
          ListFooterComponent={isAtLimit ? (
            <Text style={[styles.limitMsg, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}>
              {t('tag.limitReached', { count: TAG_LIMIT })}
            </Text>
          ) : null}
          renderItem={({ item, drag }: RenderItemParams<TagWithCount>) => (
            <ScaleDecorator>
              <Pressable
                style={[styles.tagItem, { backgroundColor: theme.colors.surface }]}
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
          )}
        />
      )}

      {/* FAB: 戻る */}
      <Pressable style={[styles.fabBack, { backgroundColor: theme.colors.primary }]} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={28} color="#FFF" />
      </Pressable>

      {/* FAB */}
      <Pressable
        style={[styles.fab, { backgroundColor: theme.colors.primary }, isAtLimit && styles.fabDisabled]}
        onPress={isAtLimit ? undefined : () => router.push('/tags/new')}
      >
        <Ionicons name="add" size={28} color="#FFF" />
      </Pressable>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontWeight: '600' },
  emptySub: {},
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
  fabDisabled: { opacity: 0.4 },
  limitMsg: { textAlign: 'center', paddingVertical: 12 },
});
