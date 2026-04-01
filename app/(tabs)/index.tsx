import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
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
import { useSettingsStore, type DeckSortOrder } from '@/store/settings';
import type { Deck } from '@/types';

function DeckCard({
  deck,
  drag,
  onDelete,
}: {
  deck: Deck;
  drag: (() => void) | null;
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
      onLongPress={drag ?? undefined}
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

const SORT_OPTIONS: { key: DeckSortOrder; labelKey: string }[] = [
  { key: 'manual',    labelKey: 'home.sortManual' },
  { key: 'name',      labelKey: 'home.sortName' },
  { key: 'cardCount', labelKey: 'home.sortCardCount' },
];

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { decks, setDecks, removeDeck, reorderDecks } = useDeckStore();
  const { deckSortOrder, setDeckSortOrder } = useSettingsStore();
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

  const sortedDecks = useMemo(() => {
    if (deckSortOrder === 'name') {
      return [...decks].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }
    if (deckSortOrder === 'cardCount') {
      return [...decks].sort((a, b) => b.cardCount - a.cardCount);
    }
    return decks; // manual
  }, [decks, deckSortOrder]);

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
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: theme.colors.primary, fontSize: theme.fontSize.xxl }]}>{decks.length}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]}>{t('stats.all')}</Text>
        </Pressable>
      </View>
      <View style={styles.sectionRow}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
          {t('home.title')}
        </Text>
        <View style={styles.sortButtons}>
          {SORT_OPTIONS.map(({ key, labelKey }) => {
            const active = deckSortOrder === key;
            return (
              <Pressable
                key={key}
                onPress={() => setDeckSortOrder(key)}
                style={[
                  styles.sortBtn,
                  { borderColor: active ? theme.colors.primary : theme.colors.border },
                  active && { backgroundColor: theme.colors.primary },
                ]}
              >
                <Text style={[
                  styles.sortBtnText,
                  { color: active ? theme.colors.primaryText : theme.colors.textSecondary, fontSize: theme.fontSize.xs },
                ]}>
                  {t(labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );

  return (
    <GestureHandlerRootView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.fixedHeader, { backgroundColor: theme.colors.background }]}>
        {StatsHeader}
      </View>
      <View style={{ flex: 1 }}>
      {decks.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="layers-outline" size={64} color={theme.colors.iconSubtle} />
          <Text style={[styles.emptyText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}>
            {t('home.empty')}
          </Text>
          <Text style={[styles.emptySubText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}>
            {t('home.emptySub')}
          </Text>
        </View>
      ) : (
        <DraggableFlatList
          data={sortedDecks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onDragEnd={({ data }) => {
            if (deckSortOrder !== 'manual') return;
            reorderDecks(data);
            updateDeckSortOrders(db, data.map((d) => d.id));
          }}
          renderItem={({ item, drag, isActive }: RenderItemParams<Deck>) => (
            <ScaleDecorator>
              <DeckCard
                deck={item}
                drag={deckSortOrder === 'manual' ? drag : null}
                onDelete={handleDelete}
              />
            </ScaleDecorator>
          )}
        />
      )}
      </View>
      <TouchableOpacity
        style={[styles.fabLeft, { backgroundColor: theme.colors.surface }]}
        onPress={() => router.push('/tags')}
        activeOpacity={0.8}
      >
        <Ionicons name="pricetags-outline" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
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
  fixedHeader: { paddingHorizontal: 16, paddingTop: 16 },
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
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontWeight: '700' },
  sortButtons: { flexDirection: 'row', gap: 6 },
  sortBtn: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sortBtnText: { fontWeight: '600' },
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
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  fabLeft: {
    position: 'absolute',
    left: 24,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
});
