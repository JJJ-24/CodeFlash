import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';
import { deleteDeck, updateDeck } from '@/lib/database/decks';
import { useDeckStore } from '@/store/decks';

export default function EditDeckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const { decks, updateDeck: updateStore, removeDeck } = useDeckStore();

  const deck = decks.find((d) => d.id === id);

  const [name, setName] = useState(deck?.name ?? '');
  const [description, setDescription] = useState(deck?.description ?? '');
  const [language, setLanguage] = useState<'ja' | 'en'>((deck?.language as 'ja' | 'en') ?? 'ja');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || !deck) return;
    setSaving(true);
    try {
      await updateDeck(db, id, { name: trimmed, description: description.trim(), language });
      updateStore({ ...deck, name: trimmed, description: description.trim(), language });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert(t('deck.delete'), t('deck.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteDeck(db, id);
          removeDeck(id);
          router.back();
        },
      },
    ]);
  }

  if (!deck) return null;

  const canSave = !!name.trim() && !saving;

  return (
    <>
      <Stack.Screen
        options={{
          title: t('deck.edit'),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 4 }}>
              <Text style={[styles.headerBtn, { color: theme.colors.textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={handleSave}
              disabled={!canSave}
              style={{ paddingHorizontal: 4 }}
            >
              <Text style={[styles.headerBtn, { color: theme.colors.primary }, !canSave && styles.disabled]}>
                {t('deck.save')}
              </Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: theme.colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
              {t('deck.name')}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder, color: theme.colors.text }]}
              placeholder={t('deck.namePlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              value={name}
              onChangeText={setName}
              autoFocus
              returnKeyType="next"
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
              {t('deck.description')}
            </Text>
            <TextInput
              style={[styles.input, styles.multiline, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder, color: theme.colors.text }]}
              placeholder={t('deck.descriptionPlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
              {t('deck.language')}
            </Text>
            <View style={styles.langRow}>
              <TouchableOpacity
                style={[styles.langBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }, language === 'ja' && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight }]}
                onPress={() => setLanguage('ja')}
              >
                <Text style={[styles.langBtnText, { color: theme.colors.textSecondary }, language === 'ja' && { color: theme.colors.primary, fontWeight: '600' }]}>
                  {t('deck.languageJa')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.langBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }, language === 'en' && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight }]}
                onPress={() => setLanguage('en')}
              >
                <Text style={[styles.langBtnText, { color: theme.colors.textSecondary }, language === 'en' && { color: theme.colors.primary, fontWeight: '600' }]}>
                  {t('deck.languageEn')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.danger }]} onPress={confirmDelete}>
            <Text style={styles.actionBtnTextLight}>{t('common.delete')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, !canSave && styles.actionBtnDisabled]} onPress={handleSave} disabled={!canSave}>
            <Text style={styles.actionBtnTextLight}>{t('deck.save')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 20, gap: 20 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: { height: 90, textAlignVertical: 'top' },
  langRow: { flexDirection: 'row', gap: 10 },
  langBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  langBtnText: { fontSize: 15 },
  headerBtn: { fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.35 },
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
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
