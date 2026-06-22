import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { resolveTagColor, contrastText } from '@/lib/tagColors';
import { getAllTags } from '@/lib/database/tags';
import { useTagStore } from '@/store/tags';

// 全角=2、半角=1 としてカウントし、上限14（全角7文字相当）で省略
function truncateTag(name: string): string {
  const LIMIT = 14;
  let width = 0;
  let i = 0;
  for (; i < name.length; i++) {
    width += name.charCodeAt(i) > 0x7e ? 2 : 1;
    if (width > LIMIT) break;
  }
  return i < name.length ? name.slice(0, i) + '…' : name;
}

interface Props {
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
}

export function TagSelector({ selectedTagIds, onChange }: Props) {
  const db = useSQLiteContext();
  const { tags, setTags } = useTagStore();
  const theme = useTheme();
  const { t } = useTranslation();

  useEffect(() => {
    if (tags.length === 0) {
      getAllTags(db).then(setTags);
    }
  }, [db]);

  if (tags.length === 0) {
    return (
      <Text style={[styles.empty, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('study.noTags')}</Text>
    );
  }

  function toggle(tagId: string) {
    if (selectedTagIds.includes(tagId)) {
      onChange(selectedTagIds.filter((id) => id !== tagId));
    } else {
      onChange([...selectedTagIds, tagId]);
    }
  }

  return (
    <View style={styles.list}>
      {tags.map((tag) => {
        const selected = selectedTagIds.includes(tag.id);
        const tagColor = resolveTagColor(tag.color, theme);
        return (
          <Pressable
            key={tag.id}
            style={[
              styles.chip,
              selected
                ? { backgroundColor: tagColor }
                : { backgroundColor: theme.colors.background, borderColor: tagColor, borderWidth: 1.5, opacity: 0.45 },
            ]}
            onPress={() => toggle(tag.id)}
          >
            {!selected && <View style={[styles.dot, { backgroundColor: tagColor }]} />}
            <Text style={[styles.chipText, { color: selected ? contrastText(tagColor) : theme.colors.text, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {truncateTag(tag.name)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontWeight: '500' },
  empty: {},
});
