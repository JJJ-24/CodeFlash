import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { DeckIcon } from '@/components/DeckIcon';
import { sortDecks } from '@/lib/sortDecks';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';
import type { Deck } from '@/types';

interface Props {
  visible: boolean;
  title: string;
  decks: Deck[];
  onSelect: (deck: Deck) => void;
  onClose: () => void;
  showCardCount?: boolean;
  emptyMessage?: string;
  /** 渡された場合「+ 新規作成」行を表示。作成された Deck を返すと自動的に onSelect が呼ばれる */
  onCreateDeck?: (name: string) => Promise<Deck>;
}

export function DeckPickerModal({ visible, title, decks, onSelect, onClose, showCardCount = false, emptyMessage, onCreateDeck }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const deckSortOrder = useSettingsStore((s) => s.deckSortOrder);
  const sortedDecks = useMemo(() => sortDecks(decks, deckSortOrder), [decks, deckSortOrder]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) {
      setCreating(false);
      setNewName('');
      setSubmitting(false);
    }
  }, [visible]);

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed || !onCreateDeck || submitting) return;
    try {
      setSubmitting(true);
      const deck = await onCreateDeck(trimmed);
      onSelect(deck);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = newName.trim().length > 0 && !submitting;

  const header = onCreateDeck ? (
    creating ? (
      <View style={[styles.item, { borderBottomColor: theme.colors.border }]}>
        <TextInput
          autoFocus
          value={newName}
          onChangeText={setNewName}
          placeholder={t('deck.name')}
          placeholderTextColor={theme.colors.textSecondary}
          style={{ flex: 1, marginRight: 8, fontSize: theme.fontSize.md, color: theme.colors.text, paddingVertical: 0 }}
          onSubmitEditing={handleCreate}
          editable={!submitting}
          returnKeyType="done"
          maxLength={50}
        />
        {submitting ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <Pressable onPress={handleCreate} disabled={!canSubmit} hitSlop={8}>
            <Ionicons
              name="checkmark"
              size={Math.round(theme.fontSize.xxl)}
              color={canSubmit ? theme.colors.primary : theme.colors.textSecondary}
            />
          </Pressable>
        )}
      </View>
    ) : (
      <Pressable
        style={[styles.item, { borderBottomColor: theme.colors.border }]}
        onPress={() => setCreating(true)}
      >
        <Ionicons name="add" size={Math.round(theme.fontSize.xl)} color={theme.colors.primary} style={{ marginRight: 8 }} />
        <Text style={[styles.itemName, { color: theme.colors.primary, fontSize: theme.fontSize.md }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
          {t('deck.createInline')}
        </Text>
      </Pressable>
    )
  ) : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* キーボード表示時にシート（下端固定）を持ち上げ、新規作成の入力欄が隠れないようにする */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
            <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {title}
            </Text>
            <FlatList
              data={sortedDecks}
              keyExtractor={(item) => item.id}
              ListHeaderComponent={header}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.item, { borderBottomColor: theme.colors.border }]}
                  onPress={() => onSelect(item)}
                >
                  {item.iconName && <DeckIcon iconName={item.iconName} colorHex={item.colorHex} style={{ marginRight: 10 }} />}
                  <Text style={[styles.itemName, { color: theme.colors.text, fontSize: theme.fontSize.md }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {item.name}
                  </Text>
                  {showCardCount && (
                    <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, flexShrink: 0 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {t('common.cardsCount', { count: item.cardCount })}
                    </Text>
                  )}
                </Pressable>
              )}
              ListEmptyComponent={
                onCreateDeck ? null : (
                  <Text style={[styles.empty, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {emptyMessage ?? t('card.noDeckToMove')}
                  </Text>
                )
              }
            />
            <Pressable style={[styles.cancel, { borderTopColor: theme.colors.border }]} onPress={onClose}>
              <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('common.cancel')}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    maxHeight: '60%',
  },
  title: {
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemName: {
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  empty: {
    padding: 20,
    textAlign: 'center',
  },
  cancel: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
