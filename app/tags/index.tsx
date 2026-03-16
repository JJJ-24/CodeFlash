import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useTheme } from '@/lib/theme';
import { createTag, deleteTag, getAllTags, updateTag, updateTagSortOrders } from '@/lib/database/tags';
import { useTagStore } from '@/store/tags';
import type { Tag } from '@/types';

const PRESET_COLORS = [
  '#E53935', '#F4511E', '#F6BF26', '#33B679',
  '#0B8043', '#039BE5', '#3F51B5', '#7986CB',
  '#8E24AA', '#616161', '#795548', '#D81B60',
];

type TagWithCount = Tag & { cardCount: number };

export default function TagsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { tags, setTags, addTag, updateTag: updateStore, removeTag, reorderTags } = useTagStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<TagWithCount | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const TAG_LIMIT = 12;
  const isAtLimit = tags.length >= TAG_LIMIT;

  useEffect(() => {
    getAllTags(db).then(setTags);
  }, []);

  function openCreate() {
    setEditTarget(null);
    setName('');
    setColor(PRESET_COLORS[0]);
    setModalVisible(true);
  }

  function openEdit(tag: TagWithCount) {
    setEditTarget(tag);
    setName(tag.name);
    setColor(tag.color);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditTarget(null);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      if (editTarget) {
        await updateTag(db, editTarget.id, { name: trimmed, color });
        updateStore({ ...editTarget, name: trimmed, color });
      } else {
        const tag = await createTag(db, { name: trimmed, color });
        addTag({ ...tag, cardCount: 0 });
      }
      closeModal();
    } finally {
      setSaving(false);
    }
  }

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

  const canSave = !!name.trim() && !saving;

  return (
    <GestureHandlerRootView style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen
        options={{
          title: t('tag.title'),
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.text,
        }}
      />

      {tags.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.colors.background }]}>
          <Ionicons name="pricetags-outline" size={56} color={theme.colors.iconSubtle} />
          <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
            {t('tag.empty')}
          </Text>
          <Text style={[styles.emptySub, { color: theme.colors.textTertiary }]}>
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
            <Text style={[styles.limitMsg, { color: theme.colors.textTertiary }]}>
              {t('tag.limitReached', { count: TAG_LIMIT })}
            </Text>
          ) : null}
          renderItem={({ item, drag }: RenderItemParams<TagWithCount>) => (
            <ScaleDecorator>
              <Pressable
                style={[styles.tagItem, { backgroundColor: theme.colors.surface }]}
                onLongPress={drag}
              >
                <View style={[styles.colorDot, { backgroundColor: item.color }]} />
                <View style={styles.tagInfo}>
                  <Text style={[styles.tagName, { color: theme.colors.text }]}>{item.name}</Text>
                  <Text style={[styles.tagCount, { color: theme.colors.textTertiary }]}>
                    {t('tag.cards', { count: item.cardCount })}
                  </Text>
                </View>
                <Pressable onPress={() => openEdit(item)} hitSlop={8} style={styles.iconBtn}>
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

      {/* FAB */}
      <Pressable
        style={[styles.fab, isAtLimit && styles.fabDisabled]}
        onPress={isAtLimit ? undefined : openCreate}
      >
        <Ionicons name="add" size={28} color="#FFF" />
      </Pressable>

      {/* タグ作成/編集モーダル */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalHeader, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]}>
            <Pressable onPress={closeModal}>
              <Text style={[styles.headerBtn, { color: theme.colors.textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
              {editTarget ? t('tag.edit') : t('tag.new')}
            </Text>
            <Pressable onPress={handleSave} disabled={!canSave}>
              <Text style={[styles.headerBtn, { color: theme.colors.primary }, !canSave && styles.disabled]}>
                {editTarget ? t('tag.save') : t('tag.create')}
              </Text>
            </Pressable>
          </View>

          <View style={styles.modalBody}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                {t('tag.name')}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder, color: theme.colors.text }]}
                placeholder={t('tag.namePlaceholder')}
                placeholderTextColor={theme.colors.textTertiary}
                value={name}
                onChangeText={setName}
                autoFocus
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                {t('tag.color')}
              </Text>
              <View style={styles.colorGrid}>
                {PRESET_COLORS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.colorCell,
                      { backgroundColor: c },
                      color === c && styles.colorCellSelected,
                    ]}
                    onPress={() => setColor(c)}
                  >
                    {color === c && (
                      <Ionicons name="checkmark" size={18} color="#FFF" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* プレビュー */}
            <View style={[styles.preview, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.previewDot, { backgroundColor: color }]} />
              <Text style={[styles.previewName, { color: theme.colors.text }]}>
                {name || t('tag.namePlaceholder')}
              </Text>
            </View>
          </View>

        </KeyboardAvoidingView>
        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
          {editTarget ? (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: theme.colors.danger }]}
              onPress={() => {
                closeModal();
                confirmDelete(editTarget);
              }}
            >
              <Text style={styles.actionBtnTextLight}>{t('common.delete')}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.actionBtn} />
          )}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, !canSave && styles.actionBtnDisabled]}
            onPress={handleSave}
            disabled={!canSave}
          >
            <Text style={styles.actionBtnTextLight}>
              {editTarget ? t('tag.save') : t('tag.create')}
            </Text>
          </TouchableOpacity>
        </View>
        </View>
      </Modal>
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
  tagInfo: { flex: 1, gap: 2 },
  tagName: { fontSize: 16, fontWeight: '500' },
  tagCount: { fontSize: 12 },
  iconBtn: { padding: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '600' },
  emptySub: { fontSize: 14 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1976D2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17, fontWeight: '600' },
  headerBtn: { fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.35 },
  modalBody: { padding: 20, gap: 20 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorCell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabDisabled: { opacity: 0.4 },
  limitMsg: { textAlign: 'center', fontSize: 13, paddingVertical: 12 },
  colorCellSelected: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    padding: 14,
  },
  previewDot: { width: 14, height: 14, borderRadius: 7 },
  previewName: { fontSize: 15 },
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnTextLight: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
