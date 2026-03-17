import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

import { BlockEditor } from '@/components/editor/BlockEditor';
import type { BlockEditorData, BlockEditorRef } from '@/components/editor/BlockEditor';
import { deleteCard, getCardById, updateCard } from '@/lib/database/cards';
import { getTagsByCardId, addTagToCard, removeTagFromCard } from '@/lib/database/tags';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';
import type { Card } from '@/types';

export default function EditCardScreen() {
  const { id, cardId } = useLocalSearchParams<{ id: string; cardId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const { updateCard: updateStore, removeCard } = useCardStore();
  const { decks, updateDeck } = useDeckStore();
  const theme = useTheme();

  const editorRef = useRef<BlockEditorRef>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [initialTagIds, setInitialTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [frontEmpty, setFrontEmpty] = useState(false);

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

  function confirmDelete() {
    Alert.alert(t('card.delete'), t('card.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteCard(db, cardId, id);
          removeCard(cardId);
          const deck = decks.find((d) => d.id === id);
          if (deck) updateDeck({ ...deck, cardCount: Math.max(deck.cardCount - 1, 0) });
          router.back();
        },
      },
    ]);
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
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.textSecondary }}>
                {t('common.cancel')}
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => editorRef.current?.save()} disabled={saving || frontEmpty} style={{ paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: saving || frontEmpty ? theme.colors.textTertiary : theme.colors.primary }}>
                {t('card.save')}
              </Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.container}>
        <BlockEditor
          ref={editorRef}
          initialData={{
            frontBlocks: card.frontContent,
            backBlocks: card.backContent,
            memoBlocks: card.memoContent,
            tagIds: initialTagIds,
          }}
          onSave={handleSave}
          onFrontEmptyChange={setFrontEmpty}
          saving={saving}
        />
        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.danger }]} onPress={confirmDelete}>
            <Text style={styles.actionBtnTextLight}>{t('common.delete')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, (saving || frontEmpty) && styles.actionBtnDisabled]} onPress={() => editorRef.current?.save()} disabled={saving || frontEmpty}>
            <Text style={styles.actionBtnTextLight}>{t('card.save')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
