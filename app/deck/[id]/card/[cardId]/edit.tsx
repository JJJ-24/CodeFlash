import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

import { BlockEditor } from '@/components/editor/BlockEditor';
import type { BlockEditorData, BlockEditorRef } from '@/components/editor/BlockEditor';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { deleteCard, getCardById, updateCard } from '@/lib/database/cards';
import { getTagsByCardId, addTagToCard, removeTagFromCard } from '@/lib/database/tags';
import { getCardPreview } from '@/lib/cardPreview';
import { CARD_EDITOR_SHORTCUTS_EDIT, CARD_EDITOR_SHORTCUTS_SORT, CARD_EDITOR_SHORTCUTS_PREVIEW } from '@/lib/cardEditorShortcuts';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';
import { useSettingsStore } from '@/store/settings';
import type { Card } from '@/types';

export default function EditCardScreen() {
  const { id, cardId, tab } = useLocalSearchParams<{ id: string; cardId: string; tab?: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { updateCard: updateStore, removeCard } = useCardStore();
  const { decks, updateDeck } = useDeckStore();
  const theme = useTheme();
  const { keyboardShortcutsEnabled } = useSettingsStore();

  const editorRef = useRef<BlockEditorRef>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [initialTagIds, setInitialTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [frontEmpty, setFrontEmpty] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

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
    const rawPreview = card ? getCardPreview(card.frontContent, t('card.imageBlock')).replace(/\n/g, ' ') : '';
    const preview = rawPreview || t('card.noText');
    const name = preview.length > 20 ? preview.slice(0, 20) + '…' : preview;
    Alert.alert(t('card.delete'), t('card.deleteConfirm', { name }), [
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

          headerTitle: () => (
            <Pressable
              onPress={keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: screenWidth * 0.5 }}
            >
              <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text, flexShrink: 1 }} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('card.edit')}
              </Text>
              {keyboardShortcutsEnabled && (
                <MaterialIcons name="keyboard" size={20} color={theme.colors.primary} />
              )}
            </Pressable>
          ),
          headerLeft: () => (
            <Pressable onPress={() => { editorRef.current?.prepareForNavigation(); router.back(); }} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="close" size={26} color={theme.colors.textSecondary} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => editorRef.current?.save()} disabled={saving || frontEmpty} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="checkmark-sharp" size={26} color={saving || frontEmpty ? theme.colors.textTertiary : theme.colors.primary} />
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
          initialTab={tab === 'back' || tab === 'memo' ? tab : undefined}
          deckName={decks.find((d) => d.id === id)?.name}
          onSave={handleSave}
          onFrontEmptyChange={setFrontEmpty}
          saving={saving}
          onCancel={() => router.back()}
          onDeleteCard={confirmDelete}
        />
        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.danger }]} onPress={confirmDelete}>
            <Text style={[styles.actionBtnTextLight, { fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('common.delete')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, (saving || frontEmpty) && styles.actionBtnDisabled]} onPress={() => editorRef.current?.save()} disabled={saving || frontEmpty}>
            <Text style={[styles.actionBtnTextLight, { fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('card.save')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        maxHeight="80%"
        sections={[
          { title: t('shortcut.editMode'), items: CARD_EDITOR_SHORTCUTS_EDIT },
          { title: t('shortcut.sortMode'), items: CARD_EDITOR_SHORTCUTS_SORT },
          { title: t('shortcut.previewMode'), items: CARD_EDITOR_SHORTCUTS_PREVIEW },
        ]}
      />
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
  actionBtnTextLight: { fontWeight: '700', color: '#FFF' },
});
