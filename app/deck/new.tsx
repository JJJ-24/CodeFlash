import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
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

import { useTheme } from '@/lib/theme';
import { createDeck } from '@/lib/database/decks';
import { useDeckStore } from '@/store/decks';

export default function NewDeckScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { addDeck } = useDeckStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState<'ja' | 'en'>('ja');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const deck = await createDeck(db, {
        name: trimmed,
        description: description.trim(),
        language,
      });
      addDeck(deck);
      router.back();
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!name.trim() && !saving;

  return (
    <>
      <Stack.Screen
        options={{
          title: t('deck.new'),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 4 }}>
              <Text style={[styles.headerBtn, { color: theme.colors.textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={handleCreate}
              disabled={!canSave}
              style={{ paddingHorizontal: 4 }}
            >
              <Text style={[styles.headerBtn, { color: theme.colors.primary }, !canSave && styles.disabled]}>
                {t('deck.create')}
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
});
