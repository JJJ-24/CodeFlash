import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useTheme } from '@/lib/theme';
import { deleteDeck, getAllDecks, updateDeckSortOrders } from '@/lib/database/decks';
import { useDeckStore } from '@/store/decks';
import type { Deck } from '@/types';

function DeckCard({
  deck,
  drag,
  onDelete,
}: {
  deck: Deck;
  drag: () => void;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();

  function confirmDelete() {
    Alert.alert(t('deck.delete'), t('deck.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => onDelete(deck.id) },
    ]);
  }

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: theme.colors.surface }]}
      onPress={() => router.push({ pathname: '/deck/[id]', params: { id: deck.id } })}
      onLongPress={drag}
      activeOpacity={0.7}
    >
      <View style={styles.cardContent}>
        <Text style={[styles.deckName, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} numberOfLines={1}>
          {deck.name}
        </Text>
        {deck.description ? (
          <Text style={[styles.deckDesc, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} numberOfLines={2}>
            {deck.description}
          </Text>
        ) : null}
      </View>
      <View style={styles.cardActions}>
        <View style={[styles.countBadge, { backgroundColor: theme.dark ? '#4B5563' : '#8B949E', marginRight: 8 }]}>
          <Text style={[styles.countBadgeText, { fontSize: theme.fontSize.sm }]}>{deck.cardCount}</Text>
        </View>
        <Pressable
          onPress={() => router.push({ pathname: '/deck/[id]/edit', params: { id: deck.id } })}
          hitSlop={8}
          style={styles.iconBtn}
        >
          <Ionicons name="pencil-outline" size={18} color={theme.colors.icon} />
        </Pressable>
        <Pressable onPress={confirmDelete} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
        </Pressable>
      </View>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { decks, setDecks, removeDeck, reorderDecks } = useDeckStore();
  const { width } = useWindowDimensions();
  // 学習画面の4ブロック幅に合わせる（padding:16×2=32, gap:8×3=24）
  const blockWidth = (width - 32 - 24) / 4;
  const [selectedFilter, setSelectedFilter] = useState<'all'>('all');

  useEffect(() => {
    getAllDecks(db).then(setDecks);
  }, [db]);

  async function handleDelete(id: string) {
    await deleteDeck(db, id);
    removeDeck(id);
  }

  const StatsHeader = (
    <View style={styles.statsHeader}>
      <View style={styles.statsRow}>
        <Pressable
          style={[
            styles.statItem,
            { backgroundColor: theme.colors.surface, width: blockWidth },
            selectedFilter === 'all' && { borderWidth: 2, borderColor: theme.colors.primary },
          ]}
          onPress={() => setSelectedFilter('all')}
        >
          <Text style={[styles.statValue, { color: theme.colors.primary, fontSize: theme.fontSize.xxl }]}>{decks.length}</Text>
          <Text style={[styles.statLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}>{t('stats.all')}</Text>
        </Pressable>
      </View>
      <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
        {t('home.title')}
      </Text>
    </View>
  );

  return (
    <GestureHandlerRootView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {decks.length === 0 ? (
        <>
          <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>{StatsHeader}</View>
          <View style={styles.emptyContainer}>
            <Ionicons name="layers-outline" size={72} color={theme.colors.iconSubtle} />
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
              {t('home.empty')}
            </Text>
            <Text style={[styles.emptySubText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}>
              {t('home.emptySub')}
            </Text>
          </View>
        </>
      ) : (
        <DraggableFlatList
          data={decks}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={StatsHeader}
          contentContainerStyle={styles.listContent}
          onDragEnd={({ data }) => {
            reorderDecks(data);
            updateDeckSortOrders(db, data.map((d) => d.id));
          }}
          renderItem={({ item, drag, isActive }: RenderItemParams<Deck>) => (
            <ScaleDecorator>
              <DeckCard deck={item} drag={drag} onDelete={handleDelete} />
            </ScaleDecorator>
          )}
        />
      )}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push({ pathname: '/deck/new' })}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={30} color="#FFF" />
      </TouchableOpacity>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  statsHeader: { paddingTop: 0, paddingBottom: 8, gap: 24 },
  statsRow: {},
  statItem: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: { fontWeight: '700' },
  statLabel: { marginTop: 2, textAlign: 'center' },
  sectionTitle: { fontWeight: '700' },
  listContent: { padding: 16, gap: 12, paddingBottom: 96 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { fontWeight: '600' },
  emptySubText: { textAlign: 'center', paddingHorizontal: 40 },
  card: {
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  cardContent: { flex: 1 },
  deckName: { fontWeight: '700', marginBottom: 4 },
  deckDesc: { marginBottom: 4 },
  cardActions: { flexDirection: 'row', gap: 8, marginLeft: 12, alignItems: 'center' },
  iconBtn: { padding: 4 },
  countBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 28,
    alignItems: 'center',
  },
  countBadgeText: { fontWeight: '700', color: '#FFF' },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1976D2',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
});
