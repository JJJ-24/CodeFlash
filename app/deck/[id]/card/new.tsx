import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const { bottom: bottomInset } = useSafeAreaInsets();
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
      <View style={styles.container}>
        <BlockEditor ref={editorRef} onSave={handleSave} saving={saving} />
        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.danger }]} onPress={() => router.back()}>
            <Text style={styles.actionBtnTextLight}>{t('common.delete')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, saving && styles.actionBtnDisabled]} onPress={() => editorRef.current?.save()} disabled={saving}>
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
