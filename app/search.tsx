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

import { searchCards, SEARCH_RESULT_LIMIT } from '@/lib/database/cards';
import type { SearchField } from '@/lib/database/cards';
import { getAllDecks } from '@/lib/database/decks';
import { getAllTags } from '@/lib/database/tags';
import { getCardPreview } from '@/lib/cardPreview';
import { sortDecks } from '@/lib/sortDecks';
import { useDismissKeyboardOnLeave } from '@/hooks/useDismissKeyboardOnLeave';
import { useTheme, MAX_FONT_MULTIPLIER, SHADOW } from '@/lib/theme';
import { resolveTagColor } from '@/lib/tagColors';
import { DeckIcon } from '@/components/DeckIcon';
import { InfoModal } from '@/components/InfoModal';
import { InfoContent } from '@/components/InfoContent';
import { CardStatsSheet } from '@/components/stats/CardStatsSheet';
import { useDeckStore } from '@/store/decks';
import { useTagStore } from '@/store/tags';
import { useSettingsStore } from '@/store/settings';
import { useProStore } from '@/store/pro';
import { useSearchSessionStore } from '@/store/search';
import type { Card, Deck } from '@/types';

// ---- MultiSelectPickerModal（汎用・タグ用） ----

type PickerItem = { id: string; name: string; color?: string };

interface MultiSelectPickerProps {
  visible: boolean;
  title: string;
  allLabel: string;
  items: PickerItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

function MultiSelectPickerModal({ visible, title, allLabel, items, selectedIds, onToggle, onClearAll, onClose }: MultiSelectPickerProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const allActive = selectedIds.length === 0;

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
              const active = isAll ? allActive : selectedIds.includes(item.id);
              return (
                <Pressable
                  style={[pickerStyles.item, { backgroundColor: active ? theme.colors.primaryLight : 'transparent' }]}
                  onPress={() => { if (isAll) { onClearAll(); } else { onToggle(item.id); } }}
                >
                  {item.color ? (
                    <View style={[pickerStyles.colorDot, { backgroundColor: active ? theme.colors.primary : item.color }]} />
                  ) : (
                    <View style={pickerStyles.colorDotPlaceholder} />
                  )}
                  <Text
                    style={[pickerStyles.itemName, { color: active ? theme.colors.primary : theme.colors.text, fontSize: theme.fontSize.md, fontWeight: active ? '600' : '400' }]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {item.name}
                  </Text>
                  {active && !isAll && (
                    <Ionicons name="checkmark" size={20} color={theme.colors.primary} />
                  )}
                </Pressable>
              );
            }}
          />
          <Pressable style={[pickerStyles.cancel, { borderTopColor: theme.colors.border }]} onPress={onClose}>
            <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('common.done')}
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

// ---- DeckMultiSelectPickerModal ----

interface DeckMultiSelectPickerProps {
  visible: boolean;
  allLabel: string;
  decks: Deck[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

function DeckMultiSelectPickerModal({ visible, allLabel, decks, selectedIds, onToggle, onClearAll, onClose }: DeckMultiSelectPickerProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const deckSortOrder = useSettingsStore((s) => s.deckSortOrder);
  const sorted = useMemo(() => sortDecks(decks, deckSortOrder), [decks, deckSortOrder]);
  const allActive = selectedIds.length === 0;

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
                style={[pickerStyles.item, { backgroundColor: allActive ? theme.colors.primaryLight : 'transparent' }]}
                onPress={onClearAll}
              >
                <View style={{ width: 10 }} />
                <Text
                  style={[pickerStyles.itemName, { color: allActive ? theme.colors.primary : theme.colors.text, fontSize: theme.fontSize.md, fontWeight: allActive ? '600' : '400' }]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  {allLabel}
                </Text>
              </Pressable>
            }
            renderItem={({ item }) => {
              const active = selectedIds.includes(item.id);
              return (
                <Pressable
                  style={[pickerStyles.item, { backgroundColor: active ? theme.colors.primaryLight : 'transparent' }]}
                  onPress={() => onToggle(item.id)}
                >
                  {item.iconName ? (
                    <DeckIcon iconName={item.iconName} colorHex={item.colorHex} style={{ marginRight: 0 }} />
                  ) : (
                    <View style={{ width: 10 }} />
                  )}
                  <Text
                    style={[pickerStyles.itemName, { color: active ? theme.colors.primary : theme.colors.text, fontSize: theme.fontSize.md, fontWeight: active ? '600' : '400' }]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {item.name}
                  </Text>
                  {active && <Ionicons name="checkmark" size={20} color={theme.colors.primary} />}
                </Pressable>
              );
            }}
          />
          <Pressable style={[pickerStyles.cancel, { borderTopColor: theme.colors.border }]} onPress={onClose}>
            <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('common.done')}
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
  const { decks, setDecks } = useDeckStore();
  const { tags, setTags } = useTagStore();
  const { lastSearchField, setLastSearchField } = useSettingsStore();
  const { isPro } = useProStore();
  const inputRef = useRef<TextInput>(null);
  useDismissKeyboardOnLeave();

  // セッション保持した直前の検索を初期値として復元する（再起動では消える）。
  const savedSearch = useSearchSessionStore.getState();
  const [query, setQuery] = useState(savedSearch.query);
  const [results, setResults] = useState<Card[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchField, setSearchField] = useState<SearchField>(lastSearchField as SearchField);

  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>(savedSearch.deckIds);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(savedSearch.tagIds);
  const [deckPickerVisible, setDeckPickerVisible] = useState(false);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [showSearchInfo, setShowSearchInfo] = useState(false);
  const [statsCardId, setStatsCardId] = useState<string | null>(null);

  const toggleDeck = (id: string) => setSelectedDeckIds((prev) =>
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
  );
  const toggleTag = (id: string) => setSelectedTagIds((prev) =>
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
  );

  const FIELD_OPTIONS: { value: SearchField; labelKey: string }[] = [
    { value: 'all',  labelKey: 'common.all' },
    { value: 'front', labelKey: 'common.front' },
    { value: 'back',  labelKey: 'common.back' },
    { value: 'memo',  labelKey: 'common.memo' },
  ];

  // リロード直後などストアが空の状態で開かれてもデッキ/タグ絞り込みを使えるよう、
  // マウント時に DB から最新のデッキ・タグを読み込んでストアへ反映する。
  useEffect(() => {
    getAllDecks(db).then(setDecks);
    getAllTags(db).then(setTags);
  }, [db, setDecks, setTags]);

  useEffect(() => {
    // 復元した検索があるときは結果を見せたいので自動フォーカス（＝キーボード表示）しない。
    if (query.trim().length > 0) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 入力内容をセッションへ保存し、再オープン時に復元できるようにする。
  useEffect(() => {
    useSearchSessionStore.getState().setSearch({ query, deckIds: selectedDeckIds, tagIds: selectedTagIds });
  }, [query, selectedDeckIds, selectedTagIds]);

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
      selectedDeckIds.length > 0 ? selectedDeckIds : undefined,
      selectedTagIds.length > 0 ? selectedTagIds : undefined,
    ).then((cards) => {
      setResults(cards);
      setSearched(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchField, selectedDeckIds.join(','), selectedTagIds.join(',')]);

  const deckMap = useMemo(() => Object.fromEntries(decks.map((d) => [d.id, d])), [decks]);
  const tagMap = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t])), [tags]);
  const tagPickerItems: PickerItem[] = tags.map((tag) => ({ id: tag.id, name: tag.name, color: resolveTagColor(tag.color, theme) }));

  const hasFilter = selectedDeckIds.length > 0 || selectedTagIds.length > 0;

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
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            style={[styles.titleText, { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
          >
            {t('card.searchTitle')}
          </Text>
          <Pressable onPress={() => setShowSearchInfo(true)} hitSlop={8} accessibilityLabel={t('card.searchInfoLabel')}>
            <Ionicons name="information-circle-outline" size={Math.max(theme.fontSize.lg, 20)} color={theme.colors.textTertiary} />
          </Pressable>
        </View>
        <Pressable
          onPress={() => setDeckPickerVisible(true)}
          style={[
            styles.filterBtn,
            { borderColor: selectedDeckIds.length > 0 ? theme.colors.primary : theme.colors.buttonBorder },
            { paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
          ]}
          hitSlop={4}
        >
          <Ionicons
            name={selectedDeckIds.length > 0 ? 'albums' : 'albums-outline'}
            size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)}
            color={selectedDeckIds.length > 0 ? theme.colors.primary : theme.colors.textSecondary}
          />
        </Pressable>
        <Pressable
          onPress={() => setTagPickerVisible(true)}
          style={[
            styles.filterBtn,
            { borderColor: selectedTagIds.length > 0 ? theme.colors.primary : theme.colors.buttonBorder },
            { paddingHorizontal: (Platform as any).isPad ? 32 : 8 },
          ]}
          hitSlop={4}
        >
          <Ionicons
            name={selectedTagIds.length > 0 ? 'pricetag' : 'pricetag-outline'}
            size={(Platform as any).isPad ? Math.max(theme.fontSize.xl, 22) : Math.max(theme.fontSize.xl, 20)}
            color={selectedTagIds.length > 0 ? theme.colors.primary : theme.colors.textSecondary}
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
          clearButtonMode="never"
          autoCorrect={false}
          autoCapitalize="none"
          keyboardAppearance={theme.dark ? 'dark' : 'light'}
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => { setQuery(''); inputRef.current?.focus(); }}
            hitSlop={8}
            style={{ paddingLeft: 4 }}
            accessibilityLabel={t('common.clear')}
          >
            <Ionicons name="close-circle" size={theme.fontSize.xxl} color={theme.colors.textTertiary} />
          </Pressable>
        )}
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
          {selectedDeckIds.map((id) => {
            const deck = deckMap[id];
            if (!deck) return null;
            return (
              <Pressable
                key={id}
                style={[styles.chip, { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary }]}
                onPress={() => toggleDeck(id)}
              >
                <Ionicons name="albums-outline" size={13} color={theme.colors.primary} />
                <Text
                  style={[styles.chipText, { color: theme.colors.primary, fontSize: theme.fontSize.sm }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  {deck.name}
                </Text>
                <Ionicons name="close" size={14} color={theme.colors.primary} />
              </Pressable>
            );
          })}
          {selectedTagIds.map((id) => {
            const tag = tagMap[id];
            if (!tag) return null;
            return (
              <Pressable
                key={id}
                style={[styles.chip, { backgroundColor: theme.colors.surface, borderColor: resolveTagColor(tag.color, theme) }]}
                onPress={() => toggleTag(id)}
              >
                {tag.color ? (
                  <View style={[styles.tagDot, { backgroundColor: resolveTagColor(tag.color, theme) }]} />
                ) : (
                  <Ionicons name="pricetag-outline" size={13} color={theme.colors.primary} />
                )}
                <Text
                  style={[styles.chipText, { color: resolveTagColor(tag.color, theme), fontSize: theme.fontSize.sm }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  {tag.name}
                </Text>
                <Ionicons name="close" size={14} color={tag.color ?? theme.colors.primary} />
              </Pressable>
            );
          })}
        </View>
      )}

      {/* 件数（スクロールしても常に見えるようリスト外に固定表示） */}
      {searched && results.length > 0 && (
        <Text
          style={[styles.resultCount, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
        >
          {results.length >= SEARCH_RESULT_LIMIT
            ? t('card.searchResultCountMax', { count: SEARCH_RESULT_LIMIT })
            : t('card.searchResultCount', { count: results.length })}
        </Text>
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
          style={{ flex: 1 }}
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const preview = getCardPreview(item.frontContent, t('card.imageBlock'));
            const deckName = deckMap[item.deckId]?.name ?? '';
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
                  <Text
                    style={[styles.deckName, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {deckName}
                  </Text>
                </View>
                <View style={[styles.cardActions, (Platform as any).isPad && { gap: 32 }]}>
                  {isPro && (
                    <Pressable onPress={() => setStatsCardId(item.id)} hitSlop={8} style={{ padding: 4 }}>
                      <Ionicons name="analytics-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => router.push({ pathname: '/deck/[id]/card/[cardId]/edit', params: { id: item.deckId, cardId: item.id } })}
                    hitSlop={8}
                    style={{ padding: 4 }}
                  >
                    <Ionicons name="pencil-sharp" size={theme.fontSize.xxl} color={theme.colors.primary} />
                  </Pressable>
                </View>
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
      <DeckMultiSelectPickerModal
        visible={deckPickerVisible}
        allLabel={t('card.allDecks')}
        decks={decks}
        selectedIds={selectedDeckIds}
        onToggle={toggleDeck}
        onClearAll={() => setSelectedDeckIds([])}
        onClose={() => setDeckPickerVisible(false)}
      />

      {/* タグ絞り込みピッカー */}
      <MultiSelectPickerModal
        visible={tagPickerVisible}
        title={t('card.filterByTag')}
        allLabel={t('card.allTags')}
        items={tagPickerItems}
        selectedIds={selectedTagIds}
        onToggle={toggleTag}
        onClearAll={() => setSelectedTagIds([])}
        onClose={() => setTagPickerVisible(false)}
      />

      <InfoModal
        visible={showSearchInfo}
        title={t('card.searchTitle')}
        message={<InfoContent text={t('card.searchInfoMessage')} />}
        onClose={() => setShowSearchInfo(false)}
      />

      <CardStatsSheet cardId={statsCardId} onClose={() => setStatsCardId(null)} />
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
  list: { paddingTop: 8, paddingBottom: 32 },
  // デッキ一覧・カード一覧と統一したカードスタイル（surface 背景・角丸・影・行間マージン）
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    ...SHADOW.subtle,
  },
  cardActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  resultCount: { marginHorizontal: 16, marginTop: 8, marginBottom: 8 },
  resultText: { flex: 1, gap: 2 },
  preview: { fontWeight: '500' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: {},
  deckName: {},
  fieldOptionText: {},
});
