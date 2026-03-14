import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Markdown from 'react-native-markdown-display';

import type { TextBlock } from '@/types';

interface Props {
  block: TextBlock;
  isPreview: boolean;
  onChange: (content: string) => void;
  onDelete: () => void;
}

export function TextBlockItem({ block, isPreview, onChange, onDelete }: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.container, focused && styles.containerFocused]}>
      <View style={styles.header}>
        <Text style={styles.typeLabel}>T</Text>
        <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteBtn}>
          <Text style={styles.deleteBtnText}>✕</Text>
        </Pressable>
      </View>

      {isPreview ? (
        <View style={styles.preview}>
          {block.content.trim() ? (
            <Markdown style={markdownStyles}>{block.content}</Markdown>
          ) : (
            <Text style={styles.placeholder}>（空のテキストブロック）</Text>
          )}
        </View>
      ) : (
        <TextInput
          style={styles.input}
          value={block.content}
          onChangeText={onChange}
          multiline
          placeholder="テキストを入力（Markdown 記法対応）"
          placeholderTextColor="#BDBDBD"
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
    backgroundColor: '#FFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    overflow: 'hidden',
  },
  containerFocused: { borderColor: '#1976D2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FAFAFA',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    gap: 8,
  },
  typeLabel: { fontSize: 12, fontWeight: '700', color: '#9E9E9E', flex: 1 },
  deleteBtn: { padding: 2 },
  deleteBtnText: { fontSize: 12, color: '#BDBDBD' },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#212121',
    minHeight: 80,
    lineHeight: 22,
  },
  preview: { paddingHorizontal: 14, paddingVertical: 12 },
  placeholder: { fontSize: 14, color: '#BDBDBD', fontStyle: 'italic' },
});

const markdownStyles = {
  body: { fontSize: 15, color: '#212121', lineHeight: 22 },
  heading1: { fontSize: 22, fontWeight: '700' as const },
  heading2: { fontSize: 18, fontWeight: '700' as const },
  code_inline: {
    backgroundColor: '#F5F5F5',
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#E53935',
  },
  fence: { backgroundColor: '#F5F5F5', borderRadius: 6, padding: 12 },
  code_block: { fontFamily: 'monospace', fontSize: 13 },
};
