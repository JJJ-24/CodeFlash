import Markdown from 'react-native-markdown-display';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Block, CodeBlock, TextBlock } from '@/types';

interface Props {
  blocks: Block[];
}

export function BlocksView({ blocks }: Props) {
  if (blocks.length === 0) {
    return <Text style={styles.empty}>（内容なし）</Text>;
  }

  return (
    <View style={styles.container}>
      {blocks.map((block, i) => {
        if (block.type === 'text') {
          return (
            <View key={i} style={styles.textBlock}>
              <Markdown style={markdownStyles}>{(block as TextBlock).content}</Markdown>
            </View>
          );
        }
        if (block.type === 'code') {
          const code = block as CodeBlock;
          return (
            <View key={i} style={styles.codeBlock}>
              <Text style={styles.codeLang}>{code.language}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text style={styles.codeText}>{code.content}</Text>
              </ScrollView>
            </View>
          );
        }
        return (
          <View key={i} style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderText}>🖼 画像ブロック</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  empty: { fontSize: 14, color: '#BDBDBD', fontStyle: 'italic', textAlign: 'center' },
  textBlock: {},
  codeBlock: {
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    overflow: 'hidden',
  },
  codeLang: {
    fontSize: 11,
    color: '#9CDCFE',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 2,
    fontWeight: '600',
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: '#D4D4D4',
    paddingHorizontal: 12,
    paddingBottom: 12,
    lineHeight: 22,
  },
  imagePlaceholder: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  imagePlaceholderText: { fontSize: 14, color: '#9E9E9E' },
});

const markdownStyles = {
  body: { fontSize: 17, color: '#212121', lineHeight: 26 },
  heading1: { fontSize: 24, fontWeight: '700' as const, marginBottom: 8 },
  heading2: { fontSize: 20, fontWeight: '700' as const, marginBottom: 6 },
  code_inline: {
    backgroundColor: '#F0F0F0',
    fontFamily: 'monospace',
    fontSize: 14,
    color: '#E53935',
  },
  fence: { backgroundColor: '#1E1E1E', borderRadius: 6, padding: 12 },
  code_block: { fontFamily: 'monospace', fontSize: 14, color: '#D4D4D4' },
};
