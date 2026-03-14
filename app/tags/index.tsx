import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
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

import { createTag, deleteTag, getAllTags, updateTag } from '@/lib/database/tags';
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
  const { tags, setTags, addTag, updateTag: updateStore, removeTag } = useTagStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<TagWithCount | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);

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
    <>
      <Stack.Screen options={{ title: t('tag.title') }} />

      {tags.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="pricetags-outline" size={56} color="#CCC" />
          <Text style={styles.emptyText}>{t('tag.empty')}</Text>
          <Text style={styles.emptySub}>{t('tag.emptySub')}</Text>
        </View>
      ) : (
        <FlatList
          data={tags}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <View style={styles.tagItem}>
              <View style={[styles.colorDot, { backgroundColor: item.color }]} />
              <View style={styles.tagInfo}>
                <Text style={styles.tagName}>{item.name}</Text>
                <Text style={styles.tagCount}>{t('tag.cards', { count: item.cardCount })}</Text>
              </View>
              <Pressable onPress={() => openEdit(item)} hitSlop={8} style={styles.iconBtn}>
                <Ionicons name="pencil-outline" size={18} color="#1976D2" />
              </Pressable>
              <Pressable onPress={() => confirmDelete(item)} hitSlop={8} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={18} color="#E53935" />
              </Pressable>
            </View>
          )}
        />
      )}

      {/* FAB */}
      <Pressable style={styles.fab} onPress={openCreate}>
        <Ionicons name="add" size={28} color="#FFF" />
      </Pressable>

      {/* タグ作成/編集モーダル */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <Pressable onPress={closeModal}>
              <Text style={styles.headerBtn}>{t('common.cancel')}</Text>
            </Pressable>
            <Text style={styles.modalTitle}>
              {editTarget ? t('tag.edit') : t('tag.new')}
            </Text>
            <Pressable onPress={handleSave} disabled={!canSave}>
              <Text style={[styles.headerBtn, styles.primary, !canSave && styles.disabled]}>
                {editTarget ? t('tag.save') : t('tag.create')}
              </Text>
            </Pressable>
          </View>

          <View style={styles.modalBody}>
            <View style={styles.field}>
              <Text style={styles.label}>{t('tag.name')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('tag.namePlaceholder')}
                value={name}
                onChangeText={setName}
                autoFocus
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>{t('tag.color')}</Text>
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
            <View style={styles.preview}>
              <View style={[styles.previewDot, { backgroundColor: color }]} />
              <Text style={styles.previewName}>{name || t('tag.namePlaceholder')}</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 0 },
  separator: { height: 1, backgroundColor: '#F0F0F0' },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  colorDot: { width: 16, height: 16, borderRadius: 8 },
  tagInfo: { flex: 1, gap: 2 },
  tagName: { fontSize: 16, color: '#212121', fontWeight: '500' },
  tagCount: { fontSize: 12, color: '#9E9E9E' },
  iconBtn: { padding: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#9E9E9E' },
  emptySub: { fontSize: 14, color: '#BDBDBD' },
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
    borderBottomColor: '#F0F0F0',
  },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#212121' },
  headerBtn: { fontSize: 16, color: '#555' },
  primary: { color: '#1976D2', fontWeight: '600' },
  disabled: { opacity: 0.35 },
  modalBody: { padding: 20, gap: 20 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: '#424242' },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#212121',
  },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
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
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    padding: 14,
  },
  previewDot: { width: 14, height: 14, borderRadius: 7 },
  previewName: { fontSize: 15, color: '#424242' },
});
