import { useEffect, useRef, useState, type RefObject } from 'react';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { resolveImageUri } from '@/lib/image';

const markdownItLinkify = MarkdownIt({ linkify: true });
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
  selectedCodeBlockIdx?: number | null;
  onSelectCodeBlock?: (codeBlockIdx: number) => void;
  onCodeRunStart?: () => void;
  scrollRef?: RefObject<ScrollView | null>;
}

export function BlocksView({ blocks, editableCode, editedContents, onCodeBlockChange, onEditFocus, onEditBlur, onSelectCodeBlock, runTrigger, editTrigger, selectedCodeBlockIdx, onCodeRunStart, scrollRef }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const containerYRef = useRef(0);
  const blockYPositions = useRef<Record<number, number>>({});
  // 現在編集中のブロック index（blocks 配列上の i）を管理
  const editingBlockIdxRef = useRef<number | null>(null);
  const [exitEditTriggers, setExitEditTriggers] = useState<Record<number, number>>({});

  function handleEditRequest(blockIdx: number) {
    const prev = editingBlockIdxRef.current;
    if (prev !== null && prev !== blockIdx) {
      setExitEditTriggers(t => ({ ...t, [prev]: (t[prev] ?? 0) + 1 }));
    }
    editingBlockIdxRef.current = blockIdx;
    onSelectCodeBlock?.(codeBlockIndexMap[blockIdx]);
  }

  // Tab キーでブロックが切り替わったら、そのブロックが画面内に入るようスクロール
  useEffect(() => {
    if (selectedCodeBlockIdx == null) return;
    let blockArrayIdx: number | undefined;
    let codeIdx = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].type === 'code') {
        if (codeIdx === selectedCodeBlockIdx) { blockArrayIdx = i; break; }
        codeIdx++;
      }
    }
    if (blockArrayIdx === undefined) return;
    if (scrollRef?.current) {
      const y = containerYRef.current + (blockYPositions.current[blockArrayIdx] ?? 0) - 8;
      scrollRef.current.scrollTo({ y: Math.max(0, y), animated: true });
    }
  }, [selectedCodeBlockIdx]);

  // 実行ボタンが押されたとき、別のブロックが編集中なら終了させる
  function handleRunRequest(blockIdx: number) {
    const prev = editingBlockIdxRef.current;
    if (prev !== null && prev !== blockIdx) {
      setExitEditTriggers(t => ({ ...t, [prev]: (t[prev] ?? 0) + 1 }));
    }
  }

  function handleEditBlur(blockIdx: number) {
    if (editingBlockIdxRef.current === blockIdx) {
      // このブロックが最後の編集ブロック → session に編集終了を通知
      editingBlockIdxRef.current = null;
      onEditBlur?.();
    }
    // 別ブロックが既に編集を引き継いでいる場合は session に通知しない
    // （onEditBlur 内の keyboardRef.focus() が新ブロックの TextInput を blur させるため）
  }

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
    link: { color: '#3B82F6', textDecorationLine: 'underline' as const },
  };

  if (blocks.length === 0) {
    return <Text style={[styles.empty, { color: theme.colors.iconSubtle }]}>{t('card.noContent')}</Text>;
  }

  const codeBlockIndexMap: Record<number, number> = {};
  let codeIdx = 0;
  blocks.forEach((block, i) => {
    if (block.type === 'code') codeBlockIndexMap[i] = codeIdx++;
  });

  return (
    <View
      style={styles.container}
      onLayout={(e) => { containerYRef.current = e.nativeEvent.layout.y; }}
    >
      {blocks.map((block, i) => {
        if (block.type === 'text') {
          return (
            <View key={i} style={styles.textBlock}>
              <Markdown markdownit={markdownItLinkify} style={markdownStyles}>{(block as TextBlock).content}</Markdown>
            </View>
          );
        }
        if (block.type === 'code') {
          return (
            <View
              key={i}
              onLayout={(e) => { blockYPositions.current[i] = e.nativeEvent.layout.y; }}
            >
              <CodeRunnerView
                block={block as CodeBlock}
                editable={editableCode}
                editedContent={editedContents?.[i]}
                onContentChange={(text) => onCodeBlockChange?.(i, text)}
                onEditFocus={onEditFocus}
                onEditBlur={() => handleEditBlur(i)}
                onEditRequest={() => handleEditRequest(i)}
                onSelectRequest={() => onSelectCodeBlock?.(codeBlockIndexMap[i])}
                onRunRequest={() => handleRunRequest(i)}
                exitEditTrigger={exitEditTriggers[i]}
                runTrigger={codeBlockIndexMap[i] === selectedCodeBlockIdx ? runTrigger : undefined}
                editTrigger={codeBlockIndexMap[i] === selectedCodeBlockIdx ? editTrigger : undefined}
                isSelected={codeBlockIndexMap[i] === selectedCodeBlockIdx}
                onRunStart={() => {
                  if (scrollRef?.current) {
                    const y = containerYRef.current + (blockYPositions.current[i] ?? 0);
                    scrollRef.current.scrollTo({ y, animated: true });
                  }
                  onCodeRunStart?.();
                }}
              />
            </View>
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
