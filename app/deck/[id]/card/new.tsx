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
  View,
} from 'react-native';

import { createCard } from '@/lib/database/cards';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';

export default function NewCardScreen() {
  const { id: deckId } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const { addCard } = useCardStore();
  const { decks, updateDeck } = useDeckStore();

  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    const trimmedFront = front.trim();
    if (!trimmedFront) return;
    setSaving(true);
    try {
      const card = await createCard(db, {
        deckId,
        frontContent: [{ type: 'text', content: trimmedFront }],
        backContent: back.trim() ? [{ type: 'text', content: back.trim() }] : [],
        memoContent: [],
      });
      addCard(card);
      // デッキの cardCount をストアに反映
      const deck = decks.find((d) => d.id === deckId);
      if (deck) {
        updateDeck({ ...deck, cardCount: deck.cardCount + 1 });
      }
      router.back();
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!front.trim() && !saving;

  return (
    <>
      <Stack.Screen
        options={{
          title: t('card.new'),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 4 }}>
              <Text style={styles.headerBtn}>{t('common.cancel')}</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={handleCreate}
              disabled={!canSave}
              style={{ paddingHorizontal: 4 }}
            >
              <Text style={[styles.headerBtn, styles.primary, !canSave && styles.disabled]}>
                {t('card.create')}
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
            <Text style={styles.label}>{t('card.front')}</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder={t('card.frontPlaceholder')}
              value={front}
              onChangeText={setFront}
              multiline
              numberOfLines={4}
              autoFocus
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t('card.back')}</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder={t('card.backPlaceholder')}
              value={back}
              onChangeText={setBack}
              multiline
              numberOfLines={4}
            />
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
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  headerBtn: { fontSize: 16, color: '#555' },
  primary: { color: '#1976D2', fontWeight: '600' },
  disabled: { opacity: 0.35 },
});
