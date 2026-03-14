import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BlockEditor } from '@/components/editor/BlockEditor';
import type { BlockEditorData } from '@/components/editor/BlockEditor';
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
      <Stack.Screen options={{ title: t('card.new') }} />
      <BlockEditor onSave={handleSave} saving={saving} />
    </>
  );
}
