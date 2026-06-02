import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmModal } from '@/components/ConfirmModal';
import { BlockEditor } from '@/components/editor/BlockEditor';
import type { BlockEditorData, BlockEditorRef, EditorMode } from '@/components/editor/BlockEditor';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { CARD_EDITOR_SHORTCUTS_EDIT, CARD_EDITOR_SHORTCUTS_SORT, CARD_EDITOR_SHORTCUTS_PREVIEW } from '@/lib/cardEditorShortcuts';
import { createCard } from '@/lib/database/cards';
import { addTagToCard } from '@/lib/database/tags';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';
import { useSettingsStore } from '@/store/settings';

export default function NewCardScreen() {
  const { id: deckId, tagId } = useLocalSearchParams<{ id: string; tagId?: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const { addCard } = useCardStore();
  const { decks, updateDeck } = useDeckStore();
  const currentDeck = decks.find((d) => d.id === deckId);
  const editorRef = useRef<BlockEditorRef>(null);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [frontEmpty, setFrontEmpty] = useState(true);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('edit');

  const initialSnapshotRef = useRef<string>(
    JSON.stringify({
      frontBlocks: [{ type: 'text', content: '' }],
      backBlocks: [{ type: 'text', content: '' }],
      memoBlocks: [{ type: 'text', content: '' }],
      tagIds: tagId ? [tagId] : [],
    })
  );

  function handleClose() {
    const current = editorRef.current?.getData();
    if (!current || JSON.stringify(current) === initialSnapshotRef.current) {
      editorRef.current?.prepareForNavigation();
      router.back();
      return;
    }
    setShowDiscardModal(true);
  }

  async function handleSave(data: BlockEditorData) {
    setSaving(true);
    try {
      const card = await createCard(db, {
        deckId,
        frontContent: data.frontBlocks,
        backContent: data.backBlocks,
        memoContent: data.memoBlocks,
      });
      await Promise.all(data.tagIds.map((tagId) => addTagToCard(db, card.id, tagId)));
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

          headerTitle: () => (
            <Pressable
              onPress={keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: screenWidth * 0.5 }}
            >
              <Text style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text, flexShrink: 1 }} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {editorMode === 'sort' ? t('editor.sortModeLabel') : editorMode === 'preview' ? t('editor.previewModeLabel') : t('card.new')}
              </Text>
              {keyboardShortcutsEnabled && (
                <MaterialIcons name="keyboard" size={20} color={theme.colors.primary} />
              )}
            </Pressable>
          ),
          headerLeft: () => (
            <Pressable onPress={handleClose} style={{ paddingHorizontal: 4 }}>
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
        <BlockEditor ref={editorRef} onSave={handleSave} onFrontEmptyChange={setFrontEmpty} saving={saving} isNewCard initialData={tagId ? { tagIds: [tagId] } : undefined} deckName={currentDeck?.name} deckIconName={currentDeck?.iconName} deckColorHex={currentDeck?.colorHex} onCancel={handleClose} onModeChange={setEditorMode} />
        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, (saving || frontEmpty) && styles.actionBtnDisabled]} onPress={() => editorRef.current?.save()} disabled={saving || frontEmpty}>
            <Ionicons name="checkmark-sharp" size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        maxHeight="80%"
        sections={
          editorMode === 'sort'
            ? [{ title: t('shortcut.sortMode'), items: CARD_EDITOR_SHORTCUTS_SORT }]
            : editorMode === 'preview'
            ? [{ title: t('shortcut.previewMode'), items: CARD_EDITOR_SHORTCUTS_PREVIEW }]
            : [{ title: t('shortcut.editMode'), items: CARD_EDITOR_SHORTCUTS_EDIT }]
        }
      />
      <ConfirmModal
        visible={showDiscardModal}
        message={t('common.discardChanges')}
        actions={!frontEmpty
          ? [
              { label: t('common.save'), onPress: () => { setShowDiscardModal(false); editorRef.current?.save(); } },
              { label: t('common.discard'), destructive: true, onPress: () => { setShowDiscardModal(false); editorRef.current?.prepareForNavigation(); router.back(); } },
            ]
          : [
              { label: t('common.discard'), destructive: true, onPress: () => { setShowDiscardModal(false); editorRef.current?.prepareForNavigation(); router.back(); } },
            ]
        }
        onClose={() => setShowDiscardModal(false)}
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
