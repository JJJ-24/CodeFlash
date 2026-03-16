import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text } from 'react-native';

import { BlockEditor } from '@/components/editor/BlockEditor';
import type { BlockEditorData, BlockEditorRef } from '@/components/editor/BlockEditor';
import { useTheme } from '@/lib/theme';
import { createCard } from '@/lib/database/cards';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';

export default function NewCardScreen() {
  const { id: deckId } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { addCard } = useCardStore();
  const { decks, updateDeck } = useDeckStore();
  const editorRef = useRef<BlockEditorRef>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(data: BlockEditorData) {
    setSaving(true);
    try {
      const card = await createCard(db, {
        deckId,
        frontContent: data.frontBlocks,
        backContent: data.backBlocks,
        memoContent: data.memoBlocks,
      });
      addCard(card);
      const deck = decks.find((d) => d.id === deckId);
      if (deck) {
        updateDeck({ ...deck, cardCount: deck.cardCount + 1 });
      }
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t('card.new'),
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.text,
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.textSecondary }}>
                {t('common.cancel')}
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => editorRef.current?.save()} disabled={saving} style={{ paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: saving ? theme.colors.textTertiary : theme.colors.primary }}>
                {t('card.save')}
              </Text>
            </Pressable>
          ),
        }}
      />
      <BlockEditor ref={editorRef} onSave={handleSave} saving={saving} />
    </>
  );
}
