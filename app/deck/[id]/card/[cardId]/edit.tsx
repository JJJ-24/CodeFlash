import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

import { BlockEditor } from '@/components/editor/BlockEditor';
import type { BlockEditorData } from '@/components/editor/BlockEditor';
import { getCardById, updateCard } from '@/lib/database/cards';
import { getTagsByCardId, addTagToCard, removeTagFromCard } from '@/lib/database/tags';
import { useCardStore } from '@/store/cards';
import type { Card } from '@/types';

export default function EditCardScreen() {
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const { updateCard: updateStore } = useCardStore();
  const theme = useTheme();

  const [card, setCard] = useState<Card | null>(null);
  const [initialTagIds, setInitialTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [loaded, tags] = await Promise.all([
        getCardById(db, cardId),
        getTagsByCardId(db, cardId),
      ]);
      setCard(loaded);
      setInitialTagIds(tags.map((t) => t.id));
    })();
  }, [cardId]);

  async function handleSave(data: BlockEditorData) {
    if (!card) return;
    setSaving(true);
    try {
      await updateCard(db, cardId, {
        frontContent: data.frontBlocks,
        backContent: data.backBlocks,
        memoContent: data.memoBlocks,
      });

      // タグの差分更新
      const toAdd = data.tagIds.filter((id) => !initialTagIds.includes(id));
      const toRemove = initialTagIds.filter((id) => !data.tagIds.includes(id));
      await Promise.all([
        ...toAdd.map((tagId) => addTagToCard(db, cardId, tagId)),
        ...toRemove.map((tagId) => removeTagFromCard(db, cardId, tagId)),
      ]);

      updateStore({
        ...card,
        frontContent: data.frontBlocks,
        backContent: data.backBlocks,
        memoContent: data.memoBlocks,
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  if (!card) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t('card.edit'),
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
        }}
      />
      <BlockEditor
        initialData={{
          frontBlocks: card.frontContent,
          backBlocks: card.backContent,
          memoBlocks: card.memoContent,
          tagIds: initialTagIds,
        }}
        onSave={handleSave}
        saving={saving}
      />
    </>
  );
}
