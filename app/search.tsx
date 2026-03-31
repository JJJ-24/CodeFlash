import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { searchCards } from '@/lib/database/cards';
import { useTheme } from '@/lib/theme';
import { useDeckStore } from '@/store/decks';
import type { Card, TextBlock } from '@/types';

function getPreviewText(blocks: Card['frontContent']): string {
  for (const block of blocks) {
    if (block.type === 'text') {
      const text = (block as TextBlock).content.trim();
      if (text) return text;
    }
  }
  return '';
}

export default function SearchScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { decks } = useDeckStore();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Card[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      setSearched(false);
      return;
    }
    const trimmed = query.trim();
    searchCards(db, trimmed).then((cards) => {
      setResults(cards);
      setSearched(true);
    });
  }, [query]);

  const deckMap = Object.fromEntries(decks.map((d) => [d.id, d.name]));

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ title: t('common.search') }} />
      {/* 検索バー */}
      <View style={[styles.searchBar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Ionicons name="search-outline" size={18} color={theme.colors.textTertiary} />
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
          placeholder={t('card.searchPlaceholder')}
          placeholderTextColor={theme.colors.textTertiary}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {/* 結果 */}
      {searched && results.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}>
            {t('card.searchNoResults')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
          )}
          renderItem={({ item }) => {
            const preview = getPreviewText(item.frontContent);
            const deckName = deckMap[item.deckId] ?? '';
            return (
              <Pressable
                style={[styles.resultItem, { backgroundColor: theme.colors.surface }]}
                onPress={() =>
                  router.push({
                    pathname: '/deck/[id]/card/[cardId]/edit',
                    params: { id: item.deckId, cardId: item.id },
                  })
                }
              >
                <View style={styles.resultText}>
                  <Text
                    style={[styles.preview, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
                    numberOfLines={2}
                  >
                    {preview || t('card.noText')}
                  </Text>
                  <Text style={[styles.deckName, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}>
                    {deckName}
                  </Text>
                </View>
                <Ionicons name="pencil-outline" size={18} color={theme.colors.primary} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1 },
  list: { paddingBottom: 32 },
  separator: { height: StyleSheet.hairlineWidth },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  resultText: { flex: 1, gap: 2 },
  preview: { fontWeight: '500', lineHeight: 22 },
  deckName: {},
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: {},
});
