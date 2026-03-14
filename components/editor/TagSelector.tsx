import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useTheme } from '@/lib/theme';
import { useTagStore } from '@/store/tags';

interface Props {
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
}

export function TagSelector({ selectedTagIds, onChange }: Props) {
  const { tags } = useTagStore();
  const theme = useTheme();
  const [query, setQuery] = useState('');

  const suggestions = query.trim()
    ? tags.filter(
        (t) =>
          t.name.toLowerCase().includes(query.toLowerCase()) &&
          !selectedTagIds.includes(t.id)
      )
    : [];

  function select(tagId: string) {
    onChange([...selectedTagIds, tagId]);
    setQuery('');
  }

  function deselect(tagId: string) {
    onChange(selectedTagIds.filter((id) => id !== tagId));
  }

  const selectedTags = tags.filter((t) => selectedTagIds.includes(t.id));

  return (
    <View style={styles.container}>
      {/* 選択済みタグチップ */}
      {selectedTags.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          <View style={styles.chipsInner}>
            {selectedTags.map((tag) => (
              <Pressable key={tag.id} style={[styles.chip, { backgroundColor: tag.color }]} onPress={() => deselect(tag.id)}>
                <Text style={styles.chipText}>{tag.name}</Text>
                <Text style={styles.chipX}>✕</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      {/* 検索入力 */}
      <TextInput
        style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder, color: theme.colors.text }]}
        value={query}
        onChangeText={setQuery}
        placeholder="タグを検索して追加..."
        placeholderTextColor={theme.colors.textTertiary}
      />

      {/* サジェスト */}
      {suggestions.length > 0 && (
        <View style={[styles.suggestions, { backgroundColor: theme.colors.surface, borderColor: theme.colors.inputBorder }]}>
          {suggestions.map((tag) => (
            <Pressable key={tag.id} style={[styles.suggestion, { borderBottomColor: theme.colors.border }]} onPress={() => select(tag.id)}>
              <View style={[styles.dot, { backgroundColor: tag.color }]} />
              <Text style={[styles.suggestionText, { color: theme.colors.text }]}>{tag.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  chips: { maxHeight: 40 },
  chipsInner: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
  },
  chipText: { fontSize: 13, color: '#FFF', fontWeight: '500' },
  chipX: { fontSize: 11, color: 'rgba(255,255,255,0.8)' },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  suggestions: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  suggestionText: { fontSize: 14 },
});
