import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Markdown from 'react-native-markdown-display';

import { useTheme } from '@/lib/theme';
import type { TextBlock } from '@/types';

interface Props {
  block: TextBlock;
  isPreview: boolean;
  onChange: (content: string) => void;
  onDelete: () => void;
  autoFocus?: boolean;
}

export function TextBlockItem({ block, isPreview, onChange, onDelete, autoFocus }: Props) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, []);
  const theme = useTheme();

  const markdownStyles = {
    body: { fontSize: 15, color: theme.colors.text, lineHeight: 22 },
    heading1: { fontSize: 22, fontWeight: '700' as const, color: theme.colors.text },
    heading2: { fontSize: 18, fontWeight: '700' as const, color: theme.colors.text },
    code_inline: {
      backgroundColor: theme.colors.background,
      fontFamily: 'monospace',
      fontSize: 13,
      color: theme.colors.danger,
    },
    fence: { backgroundColor: theme.colors.background, borderRadius: 6, padding: 12 },
    code_block: { fontFamily: 'monospace', fontSize: 13, color: theme.colors.text },
  };

  return (
    <View style={[
      styles.container,
      { backgroundColor: theme.colors.surface, borderColor: focused ? theme.colors.primary : theme.colors.inputBorder },
    ]}>
      <View style={[styles.header, { backgroundColor: theme.dark ? '#252525' : '#FAFAFA', borderBottomColor: theme.colors.border }]}>
        <Text style={[styles.typeLabel, { color: theme.colors.textTertiary }]}>T</Text>
        <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteBtn}>
          <Text style={[styles.deleteBtnText, { color: theme.colors.iconSubtle }]}>✕</Text>
        </Pressable>
      </View>

      {isPreview ? (
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
          style={[styles.input, { color: theme.colors.text }]}
          value={block.content}
          onChangeText={onChange}
          multiline
          autoFocus={autoFocus}
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
    paddingVertical: 6,
    borderBottomWidth: 1,
    gap: 8,
  },
  typeLabel: { fontSize: 12, fontWeight: '700', flex: 1 },
  deleteBtn: { padding: 2 },
  deleteBtnText: { fontSize: 12 },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 80,
    lineHeight: 22,
  },
  preview: { paddingHorizontal: 14, paddingVertical: 12 },
  placeholder: { fontSize: 14, fontStyle: 'italic' },
});
