import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useTheme } from '@/lib/theme';
import { getDueCountPerDeck, getDueCountPerTag } from '@/lib/database/reviews';
import { useDeckStore } from '@/store/decks';
import { useTagStore } from '@/store/tags';
import { getAllDecks } from '@/lib/database/decks';
import { getAllTags } from '@/lib/database/tags';

type Tab = 'decks' | 'tags';

export default function StudyScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { decks, setDecks } = useDeckStore();
  const { tags, setTags } = useTagStore();
  const [dueCounts, setDueCounts] = useState<Record<string, number>>({});
  const [tagDueCounts, setTagDueCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('decks');

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        const [loadedDecks, deckCounts, loadedTags, tagCounts] = await Promise.all([
          getAllDecks(db),
          getDueCountPerDeck(db),
          getAllTags(db),
          getDueCountPerTag(db),
        ]);
        setDecks(loadedDecks);
        setDueCounts(deckCounts);
        setTags(loadedTags);
        setTagDueCounts(tagCounts);
        setLoading(false);
      })();
    }, [db])
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* タブバー */}
      <View style={[styles.tabBar, { borderBottomColor: theme.colors.border }]}>
        {(['decks', 'tags'] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[
              styles.tab,
              activeTab === tab && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 },
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeTab === tab ? theme.colors.primary : theme.colors.textTertiary },
              ]}
            >
              {t(tab === 'decks' ? 'study.selectDeck' : 'study.selectTag')}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* デッキタブ */}
      {activeTab === 'decks' && (
        decks.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="book-outline" size={56} color={theme.colors.iconSubtle} />
            <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
              {t('study.noDecks')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={decks}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
            )}
            renderItem={({ item }) => {
              const due = dueCounts[item.id] ?? 0;
              return (
                <Pressable
                  style={[styles.deckRow, { backgroundColor: theme.colors.surface }, due === 0 && styles.deckRowDimmed]}
                  onPress={() => {
                    if (due === 0) return;
                    router.push({ pathname: '/study/session', params: { deckId: item.id } });
                  }}
                >
                  <View style={styles.deckInfo}>
                    <Text style={[styles.deckName, { color: theme.colors.text }]}>{item.name}</Text>
                    <Text style={[styles.dueLabel, { color: theme.colors.textTertiary }, due > 0 && styles.dueLabelActive]}>
                      {due > 0 ? t('study.dueCards', { count: due }) : t('study.noDue')}
                    </Text>
                  </View>
                  {due > 0 && (
                    <View style={styles.dueChip}>
                      <Text style={styles.dueChipText}>{due}</Text>
                    </View>
                  )}
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={due > 0 ? theme.colors.iconSubtle : theme.colors.border}
                  />
                </Pressable>
              );
            }}
          />
        )
      )}

      {/* タグタブ */}
      {activeTab === 'tags' && (
        tags.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="pricetag-outline" size={56} color={theme.colors.iconSubtle} />
            <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
              {t('study.noTags')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={tags}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
            )}
            renderItem={({ item }) => {
              const due = tagDueCounts[item.id] ?? 0;
              return (
                <Pressable
                  style={[styles.deckRow, { backgroundColor: theme.colors.surface }, due === 0 && styles.deckRowDimmed]}
                  onPress={() => {
                    if (due === 0) return;
                    router.push({ pathname: '/study/session', params: { tagId: item.id } });
                  }}
                >
                  <View style={styles.deckInfo}>
                    <Text style={[styles.deckName, { color: theme.colors.text }]}>{item.name}</Text>
                    <Text style={[styles.dueLabel, { color: theme.colors.textTertiary }, due > 0 && styles.dueLabelActive]}>
                      {due > 0 ? t('study.dueCards', { count: due }) : t('study.noDue')}
                    </Text>
                  </View>
                  {due > 0 && (
                    <View style={styles.dueChip}>
                      <Text style={styles.dueChipText}>{due}</Text>
                    </View>
                  )}
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={due > 0 ? theme.colors.iconSubtle : theme.colors.border}
                  />
                </Pressable>
              );
            }}
          />
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 16 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { fontSize: 14, fontWeight: '600' },
  list: { paddingHorizontal: 16 },
  separator: { height: 1 },
  deckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  deckRowDimmed: { opacity: 0.5 },
  deckInfo: { flex: 1, gap: 3 },
  deckName: { fontSize: 16, fontWeight: '600' },
  dueLabel: { fontSize: 13 },
  dueLabelActive: { color: '#1976D2' },
  dueChip: {
    backgroundColor: '#1976D2',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 28,
    alignItems: 'center',
  },
  dueChipText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
});
