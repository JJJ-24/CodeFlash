import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlockEditor } from '@/components/editor/BlockEditor';
import type { BlockEditorData, BlockEditorRef } from '@/components/editor/BlockEditor';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { createCard } from '@/lib/database/cards';
import { addTagToCard } from '@/lib/database/tags';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';
import { useSettingsStore } from '@/store/settings';

const CARD_EDITOR_SHORTCUTS_NORMAL = [
  { key: 'J / K',      descKey: 'settings.shortcutFocusCardNextPrev' },
  { key: 'E',          descKey: 'settings.shortcutEditBlock' },
  { key: 'D',          descKey: 'settings.shortcutDeleteBlock' },
  { key: 'Q',          descKey: 'settings.shortcutTabSwitchCard' },
  { key: 'P',          descKey: 'settings.shortcutTogglePreview' },
  { key: 'O',          descKey: 'settings.shortcutEnterSortMode' },
  { key: 'A',          descKey: 'settings.shortcutAddBlock' },
  { key: 'R',          descKey: 'settings.shortcutRun' },
  { key: 'T',          descKey: 'settings.shortcutScrollToTags' },
  { key: 'S',          descKey: 'settings.shortcutSave' },
  { key: 'C',          descKey: 'settings.shortcutCancelCard' },
];

const CARD_EDITOR_SHORTCUTS_SORT = [
  { key: 'J / K', descKey: 'settings.shortcutFocusCardNextPrev' },
  { key: 'U / D', descKey: 'settings.shortcutMoveBlock' },
  { key: 'O',     descKey: 'settings.shortcutExitSortMode' },
];

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
  const editorRef = useRef<BlockEditorRef>(null);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [frontEmpty, setFrontEmpty] = useState(true);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

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
                {t('card.new')}
              </Text>
              {keyboardShortcutsEnabled && (
                <MaterialIcons name="keyboard" size={20} color={theme.colors.primary} />
              )}
            </Pressable>
          ),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 4 }}>
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
        <BlockEditor ref={editorRef} onSave={handleSave} onFrontEmptyChange={setFrontEmpty} saving={saving} isNewCard initialData={tagId ? { tagIds: [tagId] } : undefined} deckName={decks.find((d) => d.id === deckId)?.name} onCancel={() => router.back()} />
        <View style={[styles.bottomBar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: Math.max(bottomInset, 16) + 12 }]}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.primary }, (saving || frontEmpty) && styles.actionBtnDisabled]} onPress={() => editorRef.current?.save()} disabled={saving || frontEmpty}>
            <Text style={[styles.actionBtnTextLight, { fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('card.create')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        maxHeight="80%"
        sections={[
          { title: t('settings.shortcutNormalMode'), items: CARD_EDITOR_SHORTCUTS_NORMAL },
          { title: t('settings.shortcutSortMode'), items: CARD_EDITOR_SHORTCUTS_SORT },
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
