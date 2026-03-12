import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { deleteDeck } from '@/lib/database/decks';
import { useDeckStore } from '@/store/decks';

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const { decks, removeDeck } = useDeckStore();

  const deck = decks.find((d) => d.id === id) ?? null;

  useEffect(() => {
    if (!deck) router.back();
  }, []);

  function confirmDelete() {
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

  if (!deck) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: deck.name,
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Pressable onPress={() => router.push({ pathname: '/deck/[id]/edit', params: { id } })} hitSlop={8}>
                <Ionicons name="pencil-outline" size={22} color="#1976D2" />
              </Pressable>
              <Pressable onPress={confirmDelete} hitSlop={8}>
                <Ionicons name="trash-outline" size={22} color="#E53935" />
              </Pressable>
            </View>
          ),
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {deck.description ? (
          <Text style={styles.description}>{deck.description}</Text>
        ) : null}

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{deck.cardCount}</Text>
            <Text style={styles.statLabel}>{t('home.cards', { count: deck.cardCount })}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.studyBtn} activeOpacity={0.8}>
          <Ionicons name="play-outline" size={20} color="#FFF" />
          <Text style={styles.studyBtnText}>{t('deck.study')}</Text>
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('deck.detail')}</Text>
          <View style={styles.emptyCards}>
            <Ionicons name="card-outline" size={52} color="#CCC" />
            <Text style={styles.emptyCardsText}>{t('deck.noCards')}</Text>
          </View>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { padding: 20, gap: 16 },
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
  section: { gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#212121' },
  emptyCards: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  emptyCardsText: { fontSize: 14, color: '#9E9E9E' },
});
