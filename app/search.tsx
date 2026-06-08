import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { searchCards } from '@/lib/database/cards';
import type { SearchField } from '@/lib/database/cards';
import { getCardPreview } from '@/lib/cardPreview';
import { sortDecks } from '@/lib/sortDecks';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { DeckIcon } from '@/components/DeckIcon';
import { useDeckStore } from '@/store/decks';
import { useTagStore } from '@/store/tags';
import { useSettingsStore } from '@/store/settings';
import type { Card, Deck } from '@/types';

// ---- FilterPickerModal ----

type PickerItem = { id: string; name: string; color?: string };

interface FilterPickerModalProps {
  visible: boolean;
  title: string;
  allLabel: string;
  items: PickerItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}

function FilterPickerModal({ visible, title, allLabel, items, selectedId, onSelect, onClear, onClose }: FilterPickerModalProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const allActive = selectedId === null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={pickerStyles.overlay} onPress={onClose}>
        <Pressable style={[pickerStyles.sheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
          <Text style={[pickerStyles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {title}
          </Text>
          <FlatList
            data={[{ id: '__all__', name: allLabel, color: undefined }, ...items]}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
            renderItem={({ item }) => {
              const isAll = item.id === '__all__';
              const active = isAll ? allActive : selectedId === item.id;
              return (
                <Pressable
                  style={[pickerStyles.item, { backgroundColor: active ? theme.colors.primary : 'transparent' }]}
                  onPress={() => { if (isAll) { onClear(); } else { onSelect(item.id); } onClose(); }}
                >
                  {item.color ? (
                    <View style={[pickerStyles.colorDot, { backgroundColor: active ? theme.colors.primaryText : item.color }]} />
                  ) : (
                    <View style={pickerStyles.colorDotPlaceholder} />
                  )}
                  <Text
                    style={[pickerStyles.itemName, { color: active ? theme.colors.primaryText : theme.colors.text, fontSize: theme.fontSize.md, fontWeight: active ? '600' : '400' }]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {item.name}
                  </Text>
                  {active && (
                    <Ionicons name="checkmark" size={20} color={theme.colors.primaryText} />
                  )}
                </Pressable>
              );
            }}
          />
          <Pressable style={[pickerStyles.cancel, { borderTopColor: theme.colors.border }]} onPress={onClose}>
            <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('common.cancel')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    maxHeight: '65%',
  },
  title: {
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 8,
    gap: 10,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  colorDotPlaceholder: {
    width: 10,
    height: 10,
    flexShrink: 0,
  },
  itemName: {
    fontWeight: '500',
    flex: 1,
  },
  cancel: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

// ---- DeckFilterPickerModal ----

interface DeckFilterPickerModalProps {
  visible: boolean;
  allLabel: string;
  decks: Deck[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}

function DeckFilterPickerModal({ visible, allLabel, decks, selectedId, onSelect, onClear, onClose }: DeckFilterPickerModalProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const deckSortOrder = useSettingsStore((s) => s.deckSortOrder);
  const sorted = useMemo(() => sortDecks(decks, deckSortOrder), [decks, deckSortOrder]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={pickerStyles.overlay} onPress={onClose}>
        <Pressable style={[pickerStyles.sheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
          <Text style={[pickerStyles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('card.filterByDeck')}
          </Text>
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
            ListHeaderComponent={
              <Pressable
                style={[pickerStyles.item, { backgroundColor: selectedId === null ? theme.colors.primary : 'transparent' }]}
                onPress={() => { onClear(); onClose(); }}
              >
                <View style={{ width: 10 }} />
                <Text
                  style={[pickerStyles.itemName, { color: selectedId === null ? theme.colors.primaryText : theme.colors.text, fontSize: theme.fontSize.md, fontWeight: selectedId === null ? '600' : '400' }]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  {allLabel}
                </Text>
                {selectedId === null && <Ionicons name="checkmark" size={20} color={theme.colors.primaryText} />}
              </Pressable>
            }
            renderItem={({ item }) => {
              const active = selectedId === item.id;
              return (
                <Pressable
                  style={[pickerStyles.item, { backgroundColor: active ? theme.colors.primary : 'transparent' }]}
                  onPress={() => { onSelect(item.id); onClose(); }}
                >
                  {item.iconName ? (
                    <DeckIcon iconName={item.iconName} colorHex={item.colorHex} style={{ marginRight: 0 }} />
                  ) : (
                    <View style={{ width: 10 }} />
                  )}
                  <Text
                    style={[pickerStyles.itemName, { color: active ? theme.colors.primaryText : theme.colors.text, fontSize: theme.fontSize.md, fontWeight: active ? '600' : '400' }]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {item.name}
                  </Text>
                  {active && <Ionicons name="checkmark" size={20} color={theme.colors.primaryText} />}
                </Pressable>
              );
            }}
          />
          <Pressable style={[pickerStyles.cancel, { borderTopColor: theme.colors.border }]} onPress={onClose}>
            <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('common.cancel')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---- SearchScreen ----

export default function SearchScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const initialTopInsetRef = useRef(insets.top);
  const { decks } = useDeckStore();
  const { tags } = useTagStore();
  const { lastSearchField, setLastSearchField } = useSettingsStore();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Card[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchField, setSearchField] = useState<SearchField>(lastSearchField as SearchField);

  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [deckPickerVisible, setDeckPickerVisible] = useState(false);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);

  const FIELD_OPTIONS: { value: SearchField; labelKey: string }[] = [
    { value: 'all',  labelKey: 'common.all' },
    { value: 'front', labelKey: 'common.front' },
    { value: 'back',  labelKey: 'common.back' },
    { value: 'memo',  labelKey: 'common.memo' },
  ];

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      setSearched(false);
      return;
    }
    searchCards(
      db,
      query.trim(),
      searchField,
      selectedDeckId ?? undefined,
      selectedTagId ?? undefined,
    ).then((cards) => {
      setResults(cards);
      setSearched(true);
    });
  }, [query, searchField, selectedDeckId, selectedTagId]);

  const deckMap = Object.fromEntries(decks.map((d) => [d.id, d.name]));
  const selectedDeckName = selectedDeckId ? (deckMap[selectedDeckId] ?? '') : null;
  const selectedTagName = selectedTagId ? (tags.find((t) => t.id === selectedTagId)?.name ?? '') : null;
  const selectedTagColor = selectedTagId ? (tags.find((t) => t.id === selectedTagId)?.color) : undefined;

  const hasFilter = selectedDeckId !== null || selectedTagId !== null;

  const tagPickerItems: PickerItem[] = tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }));

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* インラインカスタムヘッダー */}
      <View style={{ height: initialTopInsetRef.current + 44, backgroundColor: theme.colors.surface }}>
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 44,
          flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
        }}>
          <View style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }}>
            <Text
              style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t('common.search')}
            </Text>
          </View>
          <Pressable
            onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={4}
          >
            <Ionicons name="chevron-back" size={28} color={theme.colors.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 36 }} />
        </View>
      </View>

      {/* タイトル行: 「カード検索」＋フィルターアイコン */}
      <View style={styles.titleRow}>
        <Text
          style={[styles.titleText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
        >
          {t('card.searchTitle')}
        </Text>
        <Pressable
          onPress={() => setDeckPickerVisible(true)}
          style={[
            styles.filterBtn,
            { borderColor: selectedDeckId ? theme.colors.primary : theme.colors.buttonBorder },
            { paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
          ]}
          hitSlop={4}
        >
          <Ionicons
            name={selectedDeckId ? 'albums' : 'albums-outline'}
            size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)}
            color={selectedDeckId ? theme.colors.primary : theme.colors.textSecondary}
          />
        </Pressable>
        <Pressable
          onPress={() => setTagPickerVisible(true)}
          style={[
            styles.filterBtn,
            { borderColor: selectedTagId ? theme.colors.primary : theme.colors.buttonBorder },
            { paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
          ]}
          hitSlop={4}
        >
          <Ionicons
            name={selectedTagId ? 'pricetag' : 'pricetag-outline'}
            size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)}
            color={selectedTagId ? theme.colors.primary : theme.colors.textSecondary}
          />
        </Pressable>
      </View>

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
          keyboardAppearance={theme.dark ? 'dark' : 'light'}
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
              <Text
                style={[
                  styles.fieldOptionText,
                  { fontSize: theme.fontSize.sm, color: active ? '#fff' : theme.colors.textSecondary },
                  active && { fontWeight: '700' },
                ]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {t(labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* アクティブフィルターチップ */}
      {hasFilter && (
        <View style={styles.chipRow}>
          {selectedDeckId && (
            <Pressable
              style={[styles.chip, { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary }]}
              onPress={() => setSelectedDeckId(null)}
            >
              <Ionicons name="albums-outline" size={13} color={theme.colors.primary} />
              <Text
                style={[styles.chipText, { color: theme.colors.primary, fontSize: theme.fontSize.sm }]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {selectedDeckName}
              </Text>
              <Ionicons name="close" size={14} color={theme.colors.primary} />
            </Pressable>
          )}
          {selectedTagId && (
            <Pressable
              style={[styles.chip, { backgroundColor: theme.colors.surface, borderColor: selectedTagColor ?? theme.colors.primary }]}
              onPress={() => setSelectedTagId(null)}
            >
              {selectedTagColor ? (
                <View style={[styles.tagDot, { backgroundColor: selectedTagColor }]} />
              ) : (
                <Ionicons name="pricetag-outline" size={13} color={theme.colors.primary} />
              )}
              <Text
                style={[styles.chipText, { color: selectedTagColor ?? theme.colors.primary, fontSize: theme.fontSize.sm }]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {selectedTagName}
              </Text>
              <Ionicons name="close" size={14} color={selectedTagColor ?? theme.colors.primary} />
            </Pressable>
          )}
        </View>
      )}

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
                    style={[styles.preview, { color: theme.colors.text, fontSize: theme.fontSize.md, lineHeight: Math.ceil(theme.fontSize.md * 1.5) }]}
                    numberOfLines={2}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {preview || t('card.noText')}
                  </Text>
                  <Text
                    style={[styles.deckName, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {deckName}
                  </Text>
                </View>
                <Ionicons name="pencil-sharp" size={18} color={theme.colors.primary} />
              </Pressable>
            );
          }}
        />
      )}

      {/* FAB: 戻る */}
      <Pressable style={[styles.fab, { backgroundColor: theme.colors.primary }]} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={28} color="#FFF" />
      </Pressable>

      {/* デッキ絞り込みピッカー */}
      <DeckFilterPickerModal
        visible={deckPickerVisible}
        allLabel={t('card.allDecks')}
        decks={decks}
        selectedId={selectedDeckId}
        onSelect={setSelectedDeckId}
        onClear={() => setSelectedDeckId(null)}
        onClose={() => setDeckPickerVisible(false)}
      />

      {/* タグ絞り込みピッカー */}
      <FilterPickerModal
        visible={tagPickerVisible}
        title={t('card.filterByTag')}
        allLabel={t('card.allTags')}
        items={tagPickerItems}
        selectedId={selectedTagId}
        onSelect={setSelectedTagId}
        onClear={() => setSelectedTagId(null)}
        onClose={() => setTagPickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fab: {
    position: 'absolute',
    bottom: 32,
    left: 20,
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 4,
  },
  titleText: {
    flex: 1,
    fontWeight: '700',
  },
  filterBtn: {
    borderRadius: 6,
    borderWidth: 1,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: '48%',
  },
  chipText: {
    fontWeight: '600',
    flexShrink: 1,
  },
  tagDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
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
  preview: { fontWeight: '500' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: {},
  deckName: {},
  fieldOptionText: {},
});
