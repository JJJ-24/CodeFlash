import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { useTheme } from '@/lib/theme';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { useListNavigation } from '@/hooks/useListNavigation';
import { deleteCard, getCardsByTagId } from '@/lib/database/cards';
import { useSettingsStore } from '@/store/settings';
import { useDeckStore } from '@/store/decks';
import { useTagStore } from '@/store/tags';
import type { Card, Tag, TextBlock } from '@/types';

const TAG_CARDS_SHORTCUTS = [
  { key: 'J / K',   descKey: 'settings.shortcutFocusNextPrev' },
  { key: 'Return / P', descKey: 'settings.shortcutEditCard' },
  { key: 'D',     descKey: 'settings.shortcutDeleteCard' },
  { key: 'N',     descKey: 'settings.shortcutNewCard' },
  { key: 'B',     descKey: 'settings.shortcutBack' },
];

function getPreviewText(blocks: Card['frontContent']): string {
  for (const block of blocks) {
    if (block.type === 'text') {
      const text = (block as TextBlock).content.trim();
      if (text) return text;
    }
  }
  return '';
}

export default function TagCardsScreen() {
  const { tagId } = useLocalSearchParams<{ tagId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { decks } = useDeckStore();
  const { tags } = useTagStore();
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const { width: screenWidth } = useWindowDimensions();
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();

  const [cards, setCards] = useState<Card[]>([]);
  const tag = tags.find((t) => t.id === tagId) ?? null;
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const { focusedIndex: focusedCardIndex, setFocusedIndex: setFocusedCardIndex, listRef, moveFocus } = useListNavigation(cards);

  function confirmDeleteCard(card: Card) {
    const rawPreview = getPreviewText(card.frontContent);
    const preview = rawPreview || t('card.noText');
    const name = preview.length > 20 ? preview.slice(0, 20) + '…' : preview;
    Alert.alert(t('card.delete'), t('card.deleteConfirm', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteCard(db, card.id, card.deckId);
          setCards((prev) => prev.filter((c) => c.id !== card.id));
        },
      },
    ]);
  }

  function navigateToEdit(card: Card) {
    router.push({
      pathname: '/deck/[id]/card/[cardId]/edit',
      params: { id: card.deckId, cardId: card.id },
    });
  }

  useFocusEffect(
    useCallback(() => {
      getCardsByTagId(db, tagId).then(setCards);
      onScreenFocus();
      return () => { onScreenBlur(); };
    }, [db, tagId, onScreenFocus, onScreenBlur])
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable
              onPress={keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
              style={[styles.headerTitle, { maxWidth: screenWidth * 0.5 }]}
            >
              <Text
                style={{ color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: '600', flexShrink: 1 }}
                numberOfLines={1}
              >
                {tag?.name ?? ''}
              </Text>
              {keyboardShortcutsEnabled && (
                <MaterialIcons name="keyboard" size={20} color={theme.colors.primary} />
              )}
            </Pressable>
          ),
        }}
      />

      <TextInput
        ref={keyboardRef}
        style={styles.hiddenKeyboardInput}
        caretHidden
        keyboardType="ascii-capable"
        showSoftInputOnFocus={false}
        disableKeyboardShortcuts={true}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        onKeyPress={({ nativeEvent: { key } }) => {
          if (!keyboardShortcutsEnabled) return;
          const k = key.toLowerCase();
          if (k === 'j') { moveFocus('next'); }
          else if (k === 'k') { moveFocus('prev'); }
          else if (k === 'p') {
            if (focusedCardIndex !== null && cards[focusedCardIndex]) {
              navigateToEdit(cards[focusedCardIndex]);
            }
          } else if (k === 'd') {
            if (focusedCardIndex !== null && cards[focusedCardIndex]) {
              confirmDeleteCard(cards[focusedCardIndex]);
            }
          } else if (k === 'n') {
            setShowDeckPicker(true);
          } else if (k === 'b') {
            router.back();
          }
        }}
        onSubmitEditing={() => {
          if (!keyboardShortcutsEnabled) return;
          if (focusedCardIndex !== null && cards[focusedCardIndex]) {
            navigateToEdit(cards[focusedCardIndex]);
          }
        }}
        onBlur={onInputBlur}
      />

      <Pressable style={{ flex: 1 }} onPress={() => setFocusedCardIndex(null)}>
      {cards.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="card-outline" size={64} color={theme.colors.iconSubtle} />
          <Text style={[styles.emptyText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}>
            {t('deck.noCards')}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={cards}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
              {t('card.list')}
            </Text>
          }
          ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedCardIndex(null)} />}
          renderItem={({ item, index }) => {
            const preview = getPreviewText(item.frontContent);
            const isFocused = focusedCardIndex === index;
            return (
              <Pressable
                style={[
                  styles.cardItem,
                  { backgroundColor: theme.colors.surface },
                  isFocused && { borderWidth: 2, borderColor: theme.colors.primary },
                ]}
                onPress={() => {
                  setFocusedCardIndex(index);
                  navigateToEdit(item);
                }}
              >
                <Text
                  style={[styles.cardPreview, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
                  numberOfLines={2}
                >
                  {preview || t('card.noText')}
                </Text>
                <Ionicons name="pencil-outline" size={18} color={theme.colors.primary} />
                <Pressable onPress={() => confirmDeleteCard(item)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}

      {/* FAB: 戻る */}
      <Pressable style={[styles.fabBack, { backgroundColor: theme.colors.primary }]} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={28} color="#FFF" />
      </Pressable>

      {/* FAB: 新規カード作成 */}
      <Pressable
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => setShowDeckPicker(true)}
      >
        <Ionicons name="add" size={28} color="#FFF" />
      </Pressable>
      </Pressable>

      {/* デッキ選択モーダル */}
      <Modal
        visible={showDeckPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDeckPicker(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowDeckPicker(false)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>
              {t('card.newCardDeckTitle')}
            </Text>
            {decks.length === 0 ? (
              <Text style={[styles.noDeckText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}>
                {t('study.noDecks')}
              </Text>
            ) : (
              <FlatList
                data={decks}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.deckPickerItem, { borderBottomColor: theme.colors.border }]}
                    onPress={() => {
                      setShowDeckPicker(false);
                      router.push({ pathname: '/deck/[id]/card/new', params: { id: item.id, tagId } });
                    }}
                  >
                    <Text style={[styles.deckPickerName, { color: theme.colors.text, fontSize: theme.fontSize.md }]}>
                      {item.name}
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}>
                      {t('home.cards', { count: item.cardCount })}
                    </Text>
                  </Pressable>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        shortcuts={TAG_CARDS_SHORTCUTS}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hiddenKeyboardInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  list: { paddingTop: 16, paddingBottom: 96 },
  cardItem: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 20,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionTitle: { fontWeight: '700', marginBottom: 12, marginHorizontal: 20 },
  cardPreview: { flex: 1, lineHeight: 22 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: {},
  fabBack: {
    position: 'absolute',
    left: 20,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 36,
  },
  modalTitle: {
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  deckPickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  deckPickerName: { fontWeight: '600' },
  noDeckText: { paddingHorizontal: 20, paddingVertical: 16 },
});
