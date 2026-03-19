import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Markdown from 'react-native-markdown-display';

import { useTheme } from '@/lib/theme';
import type { TextBlock } from '@/types';

interface Props {
  block: TextBlock;
  isPreview: boolean;
  onChange: (content: string) => void;
  onDelete: () => void;
  autoFocus?: boolean;
  onDragStart?: () => void;
  collapsed?: boolean;
}

export function TextBlockItem({ block, isPreview, onChange, onDelete, autoFocus, onDragStart, collapsed }: Props) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, []);
  const theme = useTheme();

  const fs = (size: number) => Math.round(size * theme.fontScale);
  const markdownStyles = {
    body: { fontSize: fs(15), color: theme.colors.text, lineHeight: fs(22) },
    heading1: { fontSize: fs(22), fontWeight: '700' as const, color: theme.colors.text },
    heading2: { fontSize: fs(18), fontWeight: '700' as const, color: theme.colors.text },
    code_inline: {
      backgroundColor: theme.colors.background,
      fontFamily: 'monospace',
      fontSize: fs(13),
      color: theme.colors.danger,
    },
    fence: { backgroundColor: theme.colors.background, borderRadius: 6, padding: 12 },
    code_block: { fontFamily: 'monospace', fontSize: fs(13), color: theme.colors.text },
  };

  return (
    <View style={[
      styles.container,
      { backgroundColor: theme.colors.surface, borderColor: focused ? theme.colors.primary : theme.colors.inputBorder },
    ]}>
      <View style={[styles.header, { backgroundColor: theme.dark ? '#252525' : '#FAFAFA', borderBottomColor: theme.colors.border }]}>
        {onDragStart ? (
          <Pressable style={styles.headerDragArea} onLongPress={onDragStart} delayLongPress={500}>
            <Text style={[styles.typeLabel, { color: theme.colors.textTertiary }]}>T</Text>
          </Pressable>
        ) : (
          <View style={styles.headerDragArea}>
            <Text style={[styles.typeLabel, { color: theme.colors.textTertiary }]}>T</Text>
          </View>
        )}
        {!collapsed && (
          <Pressable
            onPress={() => Alert.alert(t('card.deleteBlock'), t('card.deleteBlockConfirm'), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.delete'), style: 'destructive', onPress: onDelete },
            ])}
            hitSlop={8}
            style={styles.deleteBtn}
          >
            <Text style={[styles.deleteBtnText, { color: theme.colors.iconSubtle }]}>✕</Text>
          </Pressable>
        )}
      </View>

      {collapsed ? (
        <Text
          style={[styles.collapsedPreview, { color: theme.colors.textTertiary }]}
          numberOfLines={2}
        >
          {block.content || '（空のテキストブロック）'}
        </Text>
      ) : isPreview ? (
        <View style={styles.preview}>
          {block.content.trim() ? (
            <Markdown style={markdownStyles}>{block.content}</Markdown>
          ) : (
            <Text style={[styles.placeholder, { color: theme.colors.textTertiary }]}>（空のテキストブロック）</Text>
          )}
        </View>
      ) : (
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: theme.colors.text, fontSize: fs(15) }]}
          value={block.content}
          onChangeText={onChange}
          multiline
          scrollEnabled={false}
          placeholder="テキストを入力（Markdown 記法対応）"
          placeholderTextColor={theme.colors.textTertiary}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          textAlignVertical="top"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  headerDragArea: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  typeLabel: { fontSize: 12, fontWeight: '700' },
  deleteBtn: { padding: 6 },
  deleteBtnText: { fontSize: 16 },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 80,
    lineHeight: 22,
  },
  preview: { paddingHorizontal: 14, paddingVertical: 12 },
  placeholder: { fontSize: 14, fontStyle: 'italic' },
  collapsedPreview: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 20,
  },
});
