import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
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

import { updateDeck } from '@/lib/database/decks';
import { useDeckStore } from '@/store/decks';

export default function EditDeckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const { decks, updateDeck: updateStore } = useDeckStore();

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

  if (!deck) return null;

  const canSave = !!name.trim() && !saving;

  return (
    <>
      <Stack.Screen
        options={{
          title: t('deck.edit'),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 4 }}>
              <Text style={styles.headerBtn}>{t('common.cancel')}</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={handleSave}
              disabled={!canSave}
              style={{ paddingHorizontal: 4 }}
            >
              <Text style={[styles.headerBtn, styles.primary, !canSave && styles.disabled]}>
                {t('deck.save')}
              </Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.field}>
            <Text style={styles.label}>{t('deck.name')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('deck.namePlaceholder')}
              value={name}
              onChangeText={setName}
              autoFocus
              returnKeyType="next"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t('deck.description')}</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder={t('deck.descriptionPlaceholder')}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t('deck.language')}</Text>
            <View style={styles.langRow}>
              <TouchableOpacity
                style={[styles.langBtn, language === 'ja' && styles.langBtnActive]}
                onPress={() => setLanguage('ja')}
              >
                <Text style={[styles.langBtnText, language === 'ja' && styles.langBtnTextActive]}>
                  {t('deck.languageJa')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.langBtn, language === 'en' && styles.langBtnActive]}
                onPress={() => setLanguage('en')}
              >
                <Text style={[styles.langBtnText, language === 'en' && styles.langBtnTextActive]}>
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
  container: { padding: 20, gap: 20 },
  field: { gap: 6 },
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
  multiline: { height: 90, textAlignVertical: 'top' },
  langRow: { flexDirection: 'row', gap: 10 },
  langBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFF',
    alignItems: 'center',
  },
  langBtnActive: { borderColor: '#1976D2', backgroundColor: '#E3F2FD' },
  langBtnText: { fontSize: 15, color: '#757575' },
  langBtnTextActive: { color: '#1976D2', fontWeight: '600' },
  headerBtn: { fontSize: 16, color: '#555' },
  primary: { color: '#1976D2', fontWeight: '600' },
  disabled: { opacity: 0.35 },
});
