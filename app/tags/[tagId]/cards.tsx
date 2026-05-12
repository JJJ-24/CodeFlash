import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { CardStatsSheet } from '@/components/stats/CardStatsSheet';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW } from '@/lib/theme';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { useKeyboardFocus } from '@/hooks/useKeyboardFocus';
import { useListNavigation } from '@/hooks/useListNavigation';
import { deleteCard, getCardsByTagId } from '@/lib/database/cards';
import { getCardPreview } from '@/lib/cardPreview';
import { useSettingsStore } from '@/store/settings';
import { useProStore } from '@/store/pro';
import { useDeckStore } from '@/store/decks';
import { useTagStore } from '@/store/tags';
import type { Card } from '@/types';

const TAG_CARDS_SHORTCUTS = [
  { key: 'J / K',   descKey: 'shortcut.focusNextPrev' },
  { key: 'P',       descKey: 'shortcut.editFocusedItem' },
  { key: 'D',     descKey: 'shortcut.deleteFocused' },
  { key: 'N',     descKey: 'shortcut.new' },
  { key: 'B',     descKey: 'shortcut.back' },
];

export default function TagCardsScreen() {
  const { tagId } = useLocalSearchParams<{ tagId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const initialTopInsetRef = useRef(insets.top);
  const lastFocusTimeRef = useRef(0);
  const { decks } = useDeckStore();
  const { tags } = useTagStore();
  const { keyboardShortcutsEnabled, cardSortOrder } = useSettingsStore();
  const { isPro } = useProStore();
  const [statsCardId, setStatsCardId] = useState<string | null>(null);
  const { width: screenWidth } = useWindowDimensions();
  const { keyboardRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();

  const [cards, setCards] = useState<Card[]>([]);
  const tag = tags.find((t) => t.id === tagId) ?? null;
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteModalMessage, setDeleteModalMessage] = useState('');
  const [pendingDeleteCard, setPendingDeleteCard] = useState<Card | null>(null);
  const { focusedIndex: focusedCardIndex, setFocusedIndex: setFocusedCardIndex, listRef, moveFocus } = useListNavigation(cards);

  function confirmDeleteCard(card: Card) {
    const rawPreview = getCardPreview(card.frontContent, t('card.imageBlock')).replace(/\n/g, ' ');
    const preview = rawPreview || t('card.noText');
    const name = preview.length > 20 ? preview.slice(0, 20) + '…' : preview;
    setPendingDeleteCard(card);
    setDeleteModalMessage(t('card.deleteConfirm', { name }));
    setShowDeleteModal(true);
  }

  async function handleDeleteConfirm() {
    if (!pendingDeleteCard) return;
    setShowDeleteModal(false);
    await deleteCard(db, pendingDeleteCard.id, pendingDeleteCard.deckId);
    setCards((prev) => prev.filter((c) => c.id !== pendingDeleteCard.id));
    setPendingDeleteCard(null);
  }

  function navigateToEdit(card: Card) {
    router.push({
      pathname: '/deck/[id]/card/[cardId]/edit',
      params: { id: card.deckId, cardId: card.id },
    });
  }

  useFocusEffect(
    useCallback(() => {
      lastFocusTimeRef.current = Date.now();
      getCardsByTagId(db, tagId).then((raw) => {
        if (cardSortOrder === 'newest') setCards([...raw].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        else if (cardSortOrder === 'oldest') setCards([...raw].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        else setCards(raw);
      });
      onScreenFocus();
      return () => { onScreenBlur(); };
    }, [db, tagId, cardSortOrder, onScreenFocus, onScreenBlur])
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* インラインカスタムヘッダー */}
      <View style={{ height: initialTopInsetRef.current + 44, backgroundColor: theme.colors.surface }}>
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 44,
          flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
        }}>
          <Pressable
            onPress={keyboardShortcutsEnabled ? () => setShowShortcutsModal(true) : undefined}
            style={{
              position: 'absolute', left: 0, right: 0,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
              paddingHorizontal: 56, gap: 4,
            }}
          >
            <Text
              style={{ color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: '600', flexShrink: 1, maxWidth: screenWidth * 0.46 }}
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {tag?.name ?? ''}
            </Text>
            {keyboardShortcutsEnabled && (
              <MaterialIcons name="keyboard" size={20} color={theme.colors.primary} />
            )}
          </Pressable>
          <Pressable
            onPress={() => { if (Date.now() - lastFocusTimeRef.current >= 350) router.back(); }}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={4}
          >
            <Ionicons name="chevron-back" size={28} color={theme.colors.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 36 }} />
        </View>
      </View>

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
          <Text style={[styles.emptyText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
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
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('card.list')}
            </Text>
          }
          ListFooterComponent={<Pressable style={{ height: 120 }} onPress={() => setFocusedCardIndex(null)} />}
          renderItem={({ item, index }) => {
            const preview = getCardPreview(item.frontContent, t('card.imageBlock'));
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
                  style={[styles.cardPreview, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}
                  numberOfLines={2}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {preview || t('card.noText')}
                </Text>
                <View style={styles.cardActions}>
                  {isPro && (
                    <Pressable onPress={() => setStatsCardId(item.id)} hitSlop={8} style={styles.iconBtn}>
                      <Ionicons name="analytics-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
                    </Pressable>
                  )}
                  <Pressable onPress={() => { setFocusedCardIndex(index); navigateToEdit(item); }} hitSlop={8} style={styles.iconBtn}>
                    <Ionicons name="pencil-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
                  </Pressable>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* FAB: 戻る */}
      <Pressable
        style={[styles.fab, { left: 20, backgroundColor: theme.colors.primary }]}
        onPress={() => { if (Date.now() - lastFocusTimeRef.current >= 350) router.back(); }}
      >
        <Ionicons name="chevron-back" size={28} color="#FFF" />
      </Pressable>

      {/* FAB: 新規カード作成 */}
      <Pressable
        style={[styles.fab, { right: 20, backgroundColor: theme.colors.primary }]}
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
            <Text style={[styles.modalTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('card.newCardDeckTitle')}
            </Text>
            {decks.length === 0 ? (
              <Text style={[styles.noDeckText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
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
                    <Text style={[styles.deckPickerName, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                      {item.name}
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, flexShrink: 0 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {t('common.cardsCount', { count: item.cardCount })}
                    </Text>
                  </Pressable>
                )}
              />
            )}
            <Pressable style={[styles.modalCancel, { borderTopColor: theme.colors.border }]} onPress={() => setShowDeckPicker(false)}>
              <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('common.cancel')}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <CardStatsSheet cardId={statsCardId} onClose={() => setStatsCardId(null)} />
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        shortcuts={TAG_CARDS_SHORTCUTS}
      />
      <ConfirmDeleteModal
        visible={showDeleteModal}
        message={deleteModalMessage}
        onConfirm={handleDeleteConfirm}
        onClose={() => { setShowDeleteModal(false); setPendingDeleteCard(null); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hiddenKeyboardInput: { position: 'absolute', width: 0, height: 0, opacity: 0 },
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
    ...SHADOW.subtle,
  },
  sectionTitle: { fontWeight: '700', marginBottom: 12, marginHorizontal: 20 },
  cardPreview: { flex: 1, lineHeight: 22 },
  cardActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  iconBtn: { padding: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
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
    maxHeight: '60%',
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
  deckPickerName: { fontWeight: '600', flex: 1, marginRight: 8 },
  noDeckText: { paddingHorizontal: 20, paddingVertical: 16 },
  modalCancel: { paddingVertical: 16, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  emptyText: {},
});
