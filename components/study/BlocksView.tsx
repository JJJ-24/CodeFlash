import Markdown from 'react-native-markdown-display';
import { StyleSheet, Text, View } from 'react-native';

import { resolveImageUri } from '@/lib/image';
import { useTheme } from '@/lib/theme';
import type { Block, CodeBlock, ImageBlock, TextBlock } from '@/types';
import { CodeRunnerView } from './CodeRunnerView';
import { ZoomableImage } from './ZoomableImage';

interface Props {
  blocks: Block[];
  editableCode?: boolean;
  editedContents?: Record<number, string>;
  onCodeBlockChange?: (index: number, text: string) => void;
  onEditFocus?: () => void;
  onEditBlur?: () => void;
  runTrigger?: number;
  editTrigger?: number;
  onCodeRunStart?: () => void;
}

export function BlocksView({ blocks, editableCode, editedContents, onCodeBlockChange, onEditFocus, onEditBlur, runTrigger, editTrigger, onCodeRunStart }: Props) {
  const theme = useTheme();

  const fs = (size: number) => Math.round(size * theme.fontScale);
  const markdownStyles = {
    body: { fontSize: fs(17), color: theme.colors.text, lineHeight: fs(26) },
    heading1: { fontSize: fs(24), fontWeight: '700' as const, marginBottom: 8 },
    heading2: { fontSize: fs(20), fontWeight: '700' as const, marginBottom: 6 },
    code_inline: {
      backgroundColor: theme.dark ? '#2C2C2C' : '#F0F0F0',
      fontFamily: 'monospace',
      fontSize: fs(14),
      color: theme.colors.danger,
    },
    fence: { backgroundColor: theme.colors.codeBackground, borderRadius: 6, padding: 12 },
    code_block: { fontFamily: 'monospace', fontSize: fs(14), color: '#D4D4D4' },
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
          return (
            <CodeRunnerView
              key={i}
              block={block as CodeBlock}
              editable={editableCode}
              editedContent={editedContents?.[i]}
              onContentChange={(text) => onCodeBlockChange?.(i, text)}
              onEditFocus={onEditFocus}
              onEditBlur={onEditBlur}
              runTrigger={runTrigger}
              editTrigger={editTrigger}
              onRunStart={onCodeRunStart}
            />
          );
        }
        const imgBlock = block as ImageBlock;
        const imgUri = imgBlock.uri ? resolveImageUri(imgBlock.uri) : null;
        return (
          <View key={i} style={styles.imageBlock}>
            {imgUri ? (
              <ZoomableImage uri={imgUri} alt={imgBlock.alt} />
            ) : (
              <View style={[styles.imagePlaceholder, { backgroundColor: theme.colors.border }]}>
                <Text style={[styles.imagePlaceholderText, { color: theme.colors.textTertiary }]}>🖼</Text>
              </View>
            )}
            {!!imgBlock.alt && (
              <Text style={[styles.altText, { color: theme.colors.textTertiary }]}>{imgBlock.alt}</Text>
            )}
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
  imageBlock: { gap: 6 },
  altText: { fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
  imagePlaceholder: {
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
  },
  imagePlaceholderText: { fontSize: 24 },
});
