import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { deleteCard, getCardsByDeckId } from '@/lib/database/cards';
import { deleteDeck } from '@/lib/database/decks';
import { useCardStore } from '@/store/cards';
import { useDeckStore } from '@/store/decks';
import type { Block, Card } from '@/types';

function getPreviewText(blocks: Block[]): string {
  const first = blocks.find((b) => b.type === 'text');
  return first?.content?.trim() ?? '';
}

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const { decks, removeDeck, updateDeck } = useDeckStore();
  const { cards, setCards, removeCard } = useCardStore();

  const deck = decks.find((d) => d.id === id) ?? null;

  const loadCards = useCallback(async () => {
    const loaded = await getCardsByDeckId(db, id);
    setCards(loaded);
  }, [db, id, setCards]);

  useEffect(() => {
    if (!deck) {
      router.back();
      return;
    }
    loadCards();
  }, []);

  function confirmDeleteDeck() {
    Alert.alert(t('deck.delete'), t('deck.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteDeck(db, id);
          removeDeck(id);
          router.back();
        },
      },
    ]);
  }

  function confirmDeleteCard(card: Card) {
    Alert.alert(t('card.delete'), t('card.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteCard(db, card.id, id);
          removeCard(card.id);
          if (deck) {
            updateDeck({ ...deck, cardCount: Math.max(deck.cardCount - 1, 0) });
          }
        },
      },
    ]);
  }

  if (!deck) return null;

  const deckCards = cards.filter((c) => c.deckId === id);

  return (
    <>
      <Stack.Screen
        options={{
          title: deck.name,
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Pressable
                onPress={() => router.push({ pathname: '/deck/[id]/edit', params: { id } })}
                hitSlop={8}
              >
                <Ionicons name="pencil-outline" size={22} color="#1976D2" />
              </Pressable>
              <Pressable onPress={confirmDeleteDeck} hitSlop={8}>
                <Ionicons name="trash-outline" size={22} color="#E53935" />
              </Pressable>
            </View>
          ),
        }}
      />

      <View style={styles.container}>
        {deck.description ? (
          <Text style={styles.description}>{deck.description}</Text>
        ) : null}

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{deck.cardCount}</Text>
            <Text style={styles.statLabel}>{t('home.cards', { count: deck.cardCount })}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.studyBtn}
          activeOpacity={0.8}
          onPress={() => router.push({ pathname: '/study/session', params: { deckId: id } })}
        >
          <Ionicons name="play-outline" size={20} color="#FFF" />
          <Text style={styles.studyBtnText}>{t('deck.study')}</Text>
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('deck.detail')}</Text>

          {deckCards.length === 0 ? (
            <View style={styles.emptyCards}>
              <Ionicons name="card-outline" size={52} color="#CCC" />
              <Text style={styles.emptyCardsText}>{t('deck.noCards')}</Text>
            </View>
          ) : (
            <FlatList
              data={deckCards}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              renderItem={({ item }) => {
                const preview = getPreviewText(item.frontContent);
                return (
                  <Pressable
                    style={styles.cardItem}
                    onLongPress={() => confirmDeleteCard(item)}
                  >
                    <Text style={styles.cardPreview} numberOfLines={2}>
                      {preview || t('card.noContent')}
                    </Text>
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/deck/[id]/card/[cardId]/edit',
                          params: { id, cardId: item.id },
                        })
                      }
                      hitSlop={8}
                    >
                      <Ionicons name="pencil-outline" size={18} color="#1976D2" />
                    </Pressable>
                    <Pressable onPress={() => confirmDeleteCard(item)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color="#BDBDBD" />
                    </Pressable>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>

      {/* FAB: 新規カード作成 */}
      <Pressable
        style={styles.fab}
        onPress={() => router.push({ pathname: '/deck/[id]/card/new', params: { id } })}
      >
        <Ionicons name="add" size={28} color="#FFF" />
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 20, gap: 16 },
  description: { fontSize: 15, color: '#616161', lineHeight: 22 },
  statsRow: { flexDirection: 'row', gap: 12 },
  statItem: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    minWidth: 90,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  statValue: { fontSize: 26, fontWeight: '700', color: '#1976D2' },
  statLabel: { fontSize: 12, color: '#9E9E9E', marginTop: 2 },
  studyBtn: {
    flexDirection: 'row',
    backgroundColor: '#1976D2',
    borderRadius: 12,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  studyBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  section: { gap: 12, flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#212121' },
  emptyCards: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  emptyCardsText: { fontSize: 14, color: '#9E9E9E' },
  cardItem: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardPreview: { flex: 1, fontSize: 15, color: '#212121', lineHeight: 22 },
  separator: { height: 8 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1976D2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
});
