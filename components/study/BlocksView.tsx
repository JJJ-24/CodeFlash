import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Keyboard, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

function LinkPressable({ href, suppress, children }: { href: string; suppress: () => void; children: React.ReactNode }) {
  const [highlighted, setHighlighted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DELAY = 400;
  return (
    <Pressable
      onPressIn={() => { timerRef.current = setTimeout(() => setHighlighted(true), DELAY); }}
      onPressOut={() => { if (timerRef.current) clearTimeout(timerRef.current); setHighlighted(false); }}
      onLongPress={() => { suppress(); Linking.openURL(href); }}
      delayLongPress={DELAY}
      style={highlighted ? { backgroundColor: 'rgba(59,130,246,0.15)', borderRadius: 3 } : undefined}
    >
      <Text style={{ color: '#3B82F6', textDecorationLine: 'underline' }}>{children}</Text>
    </Pressable>
  );
}
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { useTranslation } from 'react-i18next';

import { useFlipSuppress } from '@/lib/FlipSuppressContext';
import { resolveImageUri } from '@/lib/image';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import type { Block, CodeBlock, ImageBlock, TextBlock } from '@/types';
import { CodeRunnerView } from './CodeRunnerView';
import { ZoomableImage } from './ZoomableImage';

const markdownItLinkify = MarkdownIt({ linkify: true });

interface Props {
  blocks: Block[];
  editableCode?: boolean;
  editedContents?: Record<number, string>;
  onCodeBlockChange?: (index: number, text: string) => void;
  onEditFocus?: () => void;
  onEditBlur?: () => void;
  /** 実行ボタン経由での編集終了時にキーボードフォーカスを強制復元するコールバック */
  onForceKeyboardFocus?: () => void;
  runTrigger?: number;
  editTrigger?: number;
  exitAllEditTrigger?: number;
  selectedCodeBlockIdx?: number | null;
  onSelectCodeBlock?: (codeBlockIdx: number) => void;
  onCodeRunStart?: () => void;
  scrollRef?: RefObject<ScrollView | null>;
  scrollBaseYRef?: RefObject<number>;
}

export function BlocksView({ blocks, editableCode, editedContents, onCodeBlockChange, onEditFocus, onEditBlur, onForceKeyboardFocus, onSelectCodeBlock, runTrigger, editTrigger, exitAllEditTrigger, selectedCodeBlockIdx, onCodeRunStart, scrollRef, scrollBaseYRef }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { suppress } = useFlipSuppress();
  const containerYRef = useRef(0);
  const blockYPositions = useRef<Record<number, number>>({});
  const blockHeights = useRef<Record<number, number>>({});
  const kbHeightRef = useRef(0);
  // 現在編集中のブロック index（blocks 配列上の i）を管理
  const editingBlockIdxRef = useRef<number | null>(null);
  // CodeRunnerView に "別ブロックが編集中か" を伝えるための state（ref だけでは再描画されない）
  const [editingBlockIdx, setEditingBlockIdx] = useState<number | null>(null);
  const [exitEditTriggers, setExitEditTriggers] = useState<Record<number, number>>({});

  function handleEditRequest(blockIdx: number) {
    const prev = editingBlockIdxRef.current;
    if (prev !== null && prev !== blockIdx) {
      setExitEditTriggers(t => ({ ...t, [prev]: (t[prev] ?? 0) + 1 }));
    }
    editingBlockIdxRef.current = blockIdx;
    setEditingBlockIdx(blockIdx);
    onSelectCodeBlock?.(codeBlockIndexMap[blockIdx]);

    // 編集開始時: FlipCard の 3D トランスフォームにより iOS の自動スクロールが
    // 機能しないため、TextInput レンダリング後（400ms）にカーソル位置（ブロック末尾）
    // が見えるよう手動スクロールする。
    // キーボードがすでに表示中の場合（別ブロックから切り替え）は kbHeightRef が有効。
    // キーボードが新規表示される場合は keyboardWillShow リスナーが改めてスクロールする。
    if (scrollRef?.current) {
      setTimeout(() => {
        const base = scrollBaseYRef?.current ?? 0;
        const blockY = base + containerYRef.current + (blockYPositions.current[blockIdx] ?? 0);
        const blockH = blockHeights.current[blockIdx] ?? 0;
        const kh = kbHeightRef.current;
        // kh > 0 の場合: キーボード高さ + シンボルパレット分（約60px）を加算
        scrollRef.current?.scrollTo({
          y: Math.max(0, blockY + blockH - 300 + kh + (kh > 0 ? 60 : 0)),
          animated: true,
        });
      }, 400);
    }
  }

  // 別 BlocksView でコードが実行・選択されたとき、この BlocksView の編集中ブロックを終了させる
  useEffect(() => {
    if (!exitAllEditTrigger) return;
    const prev = editingBlockIdxRef.current;
    if (prev !== null) {
      setExitEditTriggers(t => ({ ...t, [prev]: (t[prev] ?? 0) + 1 }));
      editingBlockIdxRef.current = null;
      setEditingBlockIdx(null);
    }
  }, [exitAllEditTrigger]);

  // キーボード表示完了時に編集中ブロックが隠れないよう再スクロールする
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      const kh = e.endCoordinates.height;
      kbHeightRef.current = kh;
      const blockIdx = editingBlockIdxRef.current;
      if (blockIdx === null || !scrollRef?.current) return;
      const base = scrollBaseYRef?.current ?? 0;
      const blockY = base + containerYRef.current + (blockYPositions.current[blockIdx] ?? 0);
      const blockH = blockHeights.current[blockIdx] ?? 0;
      // シンボルパレット（約60px）+ キーボード高さ分だけ余分にスクロール
      scrollRef.current.scrollTo({
        y: Math.max(0, blockY + blockH - 300 + kh + 60),
        animated: true,
      });
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => {
      kbHeightRef.current = 0;
    });
    return () => { show.remove(); hide.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const idx = blockArrayIdx;
    const doScroll = () => {
      if (scrollRef?.current) {
        const base = scrollBaseYRef?.current ?? 0;
        const y = base + containerYRef.current + (blockYPositions.current[idx] ?? 0) - 8;
        scrollRef.current.scrollTo({ y: Math.max(0, y), animated: true });
      }
    };
    if (scrollBaseYRef) {
      // メモ欄のコードブロック: showMemo 展開と同時に呼ばれる場合があるため
      // onLayout が完了するまで少し待ってからスクロール
      const timer = setTimeout(doScroll, 100);
      return () => clearTimeout(timer);
    } else {
      doScroll();
    }
  }, [selectedCodeBlockIdx]);

  // 実行ボタンが押されたとき、別のブロックが編集中なら終了させ、keyboard focus を強制復元する
  function handleRunRequest(blockIdx: number) {
    const prev = editingBlockIdxRef.current;
    if (prev !== null && prev !== blockIdx) {
      setExitEditTriggers(t => ({ ...t, [prev]: (t[prev] ?? 0) + 1 }));
      // 別ブロックの handleCodeEditBlur は switchingCodeBlockRef ガードで
      // setKeyboardInputKey をスキップする場合があるため、ここで強制復元する
      onForceKeyboardFocus?.();
    }
  }

  function handleEditBlur(blockIdx: number) {
    if (editingBlockIdxRef.current === blockIdx) {
      // このブロックが最後の編集ブロック → session に編集終了を通知
      editingBlockIdxRef.current = null;
      setEditingBlockIdx(null);
      onEditBlur?.();
    }
    // 別ブロックが既に編集を引き継いでいる場合は session に通知しない
    // （onEditBlur 内の keyboardRef.focus() が新ブロックの TextInput を blur させるため）
  }

  const fs = (size: number) => Math.round(size * theme.fontScale);
  const markdownStyles = useMemo(() => ({
    body: { fontSize: fs(17), color: theme.colors.text, lineHeight: fs(26) },
    heading1: { fontSize: fs(24), fontWeight: '700' as const, marginBottom: 8 },
    heading2: { fontSize: fs(20), fontWeight: '700' as const, marginBottom: 6 },
    strong: { fontWeight: 'bold' as const },
    em: { fontStyle: 'italic' as const },
    code_inline: {
      backgroundColor: theme.dark ? '#2C2C2C' : '#F0F0F0',
      fontFamily: 'monospace',
      fontSize: fs(14),
      color: theme.colors.danger,
    },
    fence: { backgroundColor: '#1E1E1E', borderRadius: 6, padding: 12, color: '#D4D4D4', fontFamily: 'monospace', fontSize: fs(14) },
    code_block: { fontFamily: 'monospace', fontSize: fs(14), color: '#D4D4D4', backgroundColor: '#1E1E1E' },
    link: { color: '#3B82F6', textDecorationLine: 'underline' as const },
    blockquote: {
      backgroundColor: theme.dark ? '#2A2A2A' : '#F0F0F0',
      borderLeftWidth: 4,
      borderLeftColor: theme.colors.textSecondary,
      paddingHorizontal: 12,
      paddingVertical: 4,
      marginVertical: 4,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme]);

  const linkRule = useMemo(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    link: (node: any, children: any) => (
      <LinkPressable key={node.key} href={node.attributes.href} suppress={suppress}>
        {children}
      </LinkPressable>
    ),
  }), [suppress]);

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
              <Markdown markdownit={markdownItLinkify} style={markdownStyles} onLinkPress={() => false} rules={linkRule}>{(block as TextBlock).content}</Markdown>
            </View>
          );
        }
        if (block.type === 'code') {
          return (
            <View
              key={i}
              onLayout={(e) => {
                blockYPositions.current[i] = e.nativeEvent.layout.y;
                blockHeights.current[i] = e.nativeEvent.layout.height;
              }}
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
                onForceKeyboardFocus={onForceKeyboardFocus}
                exitEditTrigger={exitEditTriggers[i]}
                runTrigger={codeBlockIndexMap[i] === selectedCodeBlockIdx ? runTrigger : undefined}
                editTrigger={codeBlockIndexMap[i] === selectedCodeBlockIdx ? editTrigger : undefined}
                isSelected={codeBlockIndexMap[i] === selectedCodeBlockIdx}
                anotherBlockEditing={editingBlockIdx !== null && editingBlockIdx !== i}
                onRunStart={() => {
                  onCodeRunStart?.();
                  if (!scrollRef?.current) return;
                  // 出力レイアウト更新後（400ms）にブロック下端が見える位置へスクロール
                  setTimeout(() => {
                    const base = scrollBaseYRef?.current ?? 0;
                    const y = base + containerYRef.current + (blockYPositions.current[i] ?? 0);
                    const h = blockHeights.current[i] ?? 0;
                    const kh = kbHeightRef.current;
                    scrollRef.current?.scrollTo({ y: Math.max(0, y + h - 300 + kh + (kh > 0 ? 60 : 0)), animated: true });
                  }, 400);
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
              <Text style={[styles.altText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{imgBlock.alt}</Text>
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
  altText: { textAlign: 'center', fontStyle: 'italic' },
  imagePlaceholder: {
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
  },
  imagePlaceholderText: { fontSize: 24 },
});
