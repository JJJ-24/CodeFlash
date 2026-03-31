import { Ionicons } from '@expo/vector-icons';
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
  View,
} from 'react-native';

import { useTheme } from '@/lib/theme';
import { deleteCard, getCardsByTagId } from '@/lib/database/cards';
import { getAllTags } from '@/lib/database/tags';
import { useDeckStore } from '@/store/decks';
import type { Card, Tag, TextBlock } from '@/types';

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

  const [cards, setCards] = useState<Card[]>([]);
  const [tag, setTag] = useState<Tag | null>(null);
  const [showDeckPicker, setShowDeckPicker] = useState(false);

  function confirmDeleteCard(card: Card) {
    Alert.alert(t('card.delete'), t('card.deleteConfirm'), [
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

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [loadedCards, allTags] = await Promise.all([
          getCardsByTagId(db, tagId),
          getAllTags(db),
        ]);
        setCards(loadedCards);
        setTag(allTags.find((t) => t.id === tagId) ?? null);
      })();
    }, [db, tagId])
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ title: tag?.name ?? '' }} />

      {cards.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="card-outline" size={64} color={theme.colors.iconSubtle} />
          <Text style={[styles.emptyText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}>
            {t('deck.noCards')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
              {t('card.list')}
            </Text>
          }
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
          )}
          renderItem={({ item }) => {
            const preview = getPreviewText(item.frontContent);
            return (
              <Pressable
                style={[styles.cardItem, { backgroundColor: theme.colors.surface }]}
                onPress={() =>
                  router.push({
                    pathname: '/deck/[id]/card/[cardId]/edit',
                    params: { id: item.deckId, cardId: item.id },
                  })
                }
              >
                <Text
                  style={[styles.cardPreview, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
                  numberOfLines={2}
                >
                  {preview || t('card.noText')}
                </Text>
                <Ionicons name="pencil-outline" size={18} color={theme.colors.primary} />
                <Pressable onPress={() => confirmDeleteCard(item)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={theme.colors.iconSubtle} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, paddingBottom: 96 },
  separator: { height: 1 },
  cardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  sectionTitle: { fontWeight: '700', marginBottom: 12 },
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
