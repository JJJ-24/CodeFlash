import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/lib/theme';
import { deleteTag, updateTag } from '@/lib/database/tags';
import { useTagStore } from '@/store/tags';

const PRESET_COLORS = [
  '#E53935', '#F4511E', '#F6BF26', '#33B679',
  '#0B8043', '#039BE5', '#3F51B5', '#7986CB',
  '#8E24AA', '#616161', '#795548', '#D81B60',
];

export default function EditTagScreen() {
  const { tagId } = useLocalSearchParams<{ tagId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { tags, updateTag: updateStore, removeTag } = useTagStore();
  const { bottom: bottomInset } = useSafeAreaInsets();

  const existingTag = tags.find((t) => t.id === tagId);

  const [name, setName] = useState(existingTag?.name ?? '');
  const [color, setColor] = useState(existingTag?.color ?? PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (existingTag) {
      setName(existingTag.name);
      setColor(existingTag.color);
    }
  }, [tagId]);

  const canSave = !!name.trim() && !saving;

  async function handleSave() {
    if (!existingTag) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (tags.some((tag) => tag.name === trimmed && tag.id !== tagId)) {
      setError(t('tag.duplicateName'));
      return;
    }
    setSaving(true);
    try {
      await updateTag(db, tagId, { name: trimmed, color });
      updateStore({ ...existingTag, name: trimmed, color });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!existingTag) return;
    Alert.alert(t('tag.delete'), t('tag.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteTag(db, tagId);
          removeTag(tagId);
          router.back();
        },
      },
    ]);
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t('tag.edit'),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.textSecondary }}>
                {t('common.cancel')}
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={handleSave} disabled={!canSave} style={{ paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: canSave ? theme.colors.primary : theme.colors.textTertiary }}>
                {t('tag.save')}
              </Text>
            </Pressable>
          ),
        }}
      />
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
              {t('tag.name')}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder, color: theme.colors.text }]}
              placeholder={t('tag.namePlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              value={name}
              onChangeText={(v) => { setName(v); setError(''); }}
              autoFocus
            />
            {!!error && (
              <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize.sm }}>{error}</Text>
            )}
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
              {t('tag.color')}
            </Text>
            <View style={styles.colorGrid}>
              {PRESET_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorCell, { backgroundColor: c }, color === c && styles.colorCellSelected]}
                  onPress={() => setColor(c)}
                >
                  {color === c && <Ionicons name="checkmark" size={18} color="#FFF" />}
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={[styles.preview, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.previewDot, { backgroundColor: color }]} />
            <Text style={[styles.previewName, { color: theme.colors.text }]}>
              {name || t('tag.namePlaceholder')}
            </Text>
          </View>
        </ScrollView>

        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.danger }]}
            onPress={confirmDelete}
          >
            <Text style={styles.actionBtnTextLight}>{t('common.delete')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, !canSave && styles.actionBtnDisabled]}
            onPress={handleSave}
            disabled={!canSave}
          >
            <Text style={styles.actionBtnTextLight}>{t('tag.save')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: 20, gap: 20 },
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
