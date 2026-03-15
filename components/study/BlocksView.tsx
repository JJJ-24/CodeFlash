import Markdown from 'react-native-markdown-display';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import type { Block, CodeBlock, TextBlock } from '@/types';
import { CodeRunnerView } from './CodeRunnerView';

interface Props {
  blocks: Block[];
}

export function BlocksView({ blocks }: Props) {
  const theme = useTheme();

  const markdownStyles = {
    body: { fontSize: 17, color: theme.colors.text, lineHeight: 26 },
    heading1: { fontSize: 24, fontWeight: '700' as const, marginBottom: 8 },
    heading2: { fontSize: 20, fontWeight: '700' as const, marginBottom: 6 },
    code_inline: {
      backgroundColor: theme.dark ? '#2C2C2C' : '#F0F0F0',
      fontFamily: 'monospace',
      fontSize: 14,
      color: theme.colors.danger,
    },
    fence: { backgroundColor: theme.colors.codeBackground, borderRadius: 6, padding: 12 },
    code_block: { fontFamily: 'monospace', fontSize: 14, color: '#D4D4D4' },
  };

  if (blocks.length === 0) {
    return <Text style={[styles.empty, { color: theme.colors.iconSubtle }]}>（内容なし）</Text>;
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
          return <CodeRunnerView key={i} block={block as CodeBlock} />;
        }
        return (
          <View key={i} style={[styles.imagePlaceholder, { backgroundColor: theme.colors.border }]}>
            <Text style={[styles.imagePlaceholderText, { color: theme.colors.textTertiary }]}>🖼 画像ブロック</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  empty: { fontSize: 14, fontStyle: 'italic', textAlign: 'center' },
  textBlock: {},
  imagePlaceholder: {
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  imagePlaceholderText: { fontSize: 14 },
});
