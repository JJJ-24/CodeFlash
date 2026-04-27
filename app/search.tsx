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
import type { SearchField } from '@/lib/database/cards';
import { getCardPreview } from '@/lib/cardPreview';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useDeckStore } from '@/store/decks';
import { useSettingsStore } from '@/store/settings';
import type { Card } from '@/types';

export default function SearchScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { decks } = useDeckStore();
  const { lastSearchField, setLastSearchField } = useSettingsStore();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Card[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchField, setSearchField] = useState<SearchField>(lastSearchField as SearchField);

  const FIELD_OPTIONS: { value: SearchField; labelKey: string }[] = [
    { value: 'all',  labelKey: 'common.all' },
    { value: 'front', labelKey: 'common.front' },
    { value: 'back',  labelKey: 'common.back' },
    { value: 'memo',  labelKey: 'common.memo' },
  ];

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
    searchCards(db, trimmed, searchField).then((cards) => {
      setResults(cards);
      setSearched(true);
    });
  }, [query, searchField]);

  const deckMap = Object.fromEntries(decks.map((d) => [d.id, d.name]));

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerTitle: () => <Text style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('common.search')}</Text> }} />
      {/* 検索バー */}
      <View style={[styles.searchBar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Ionicons name="search-outline" size={18} color={theme.colors.textTertiary} />
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
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

      {/* 検索対象フィールド */}
      <View style={[styles.fieldSelector, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        {FIELD_OPTIONS.map(({ value, labelKey }) => {
          const active = searchField === value;
          return (
            <Pressable
              key={value}
              style={[styles.fieldOption, active && { backgroundColor: theme.colors.primary }]}
              onPress={() => { setSearchField(value); setLastSearchField(value); }}
            >
              <Text style={[styles.fieldOptionText, { fontSize: theme.fontSize.sm, color: active ? '#fff' : theme.colors.textSecondary }, active && { fontWeight: '700' }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t(labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 結果 */}
      {searched && results.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
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
            const preview = getCardPreview(item.frontContent, t('card.imageBlock'));
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
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {preview || t('card.noText')}
                  </Text>
                  <Text style={[styles.deckName, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                    {deckName}
                  </Text>
                </View>
                <Ionicons name="pencil-sharp" size={18} color={theme.colors.primary} />
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
  fieldSelector: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fieldOption: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
  },
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: {},
  deckName: {},
  fieldOptionText: {},
});
