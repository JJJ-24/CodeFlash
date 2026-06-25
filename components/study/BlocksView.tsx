import { useEffect, useMemo, useRef, useState, useCallback, type RefObject } from 'react';
import { Dimensions, Keyboard, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';

import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import markdownItMark from 'markdown-it-mark';
import { useTranslation } from 'react-i18next';

import { Image } from 'expo-image';
import { useFlipSuppress } from '@/lib/FlipSuppressContext';
import { resolveImageUri } from '@/lib/image';
import { useTheme, MAX_FONT_MULTIPLIER, HIGHLIGHT_COLORS } from '@/lib/theme';
import type { Block, CodeBlock, ImageBlock, TextBlock } from '@/types';
import { CodeRunnerView } from './CodeRunnerView';
import { ZoomableImage } from './ZoomableImage';

// 生URL も自動リンク化する。リンクは linkRule でインラインの Text として描画するため
// （Pressable を使わない）、本文と同じフォントサイズで流れて表示がズレない。
// markdownItMark: ==文字== をハイライト（<mark>）化（編集プレビューと表示を揃える）。
const mdInstance = MarkdownIt({ linkify: true }).use(markdownItMark);

function TextBlockCopyBtn({ content, suppress }: { content: string; suppress: () => void }) {
  const [copied, setCopied] = useState(false);
  const theme = useTheme();
  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }, [content]);
  return (
    <Pressable style={styles.textCopyBtn} onPress={handleCopy} onTouchStart={suppress} hitSlop={8}>
      <Ionicons name={copied ? 'checkmark-sharp' : 'copy-outline'} size={theme.fontSize.sm} color="#4B5563" />
    </Pressable>
  );
}

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
  /** デッキ共通の SQL 初期化（SQL コードブロック実行時に本体の前に流す） */
  deckSqlInit?: string | null;
}

export function BlocksView({ blocks, editableCode, editedContents, onCodeBlockChange, onEditFocus, onEditBlur, onForceKeyboardFocus, onSelectCodeBlock, runTrigger, editTrigger, exitAllEditTrigger, selectedCodeBlockIdx, onCodeRunStart, scrollRef, scrollBaseYRef, deckSqlInit }: Props) {
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

  // ブロック末尾（シンボルパレット含む）がキーボード上端より 16px 上に来るようスクロール。
  // measure() の pageY（ScrollView のスクリーン上 Y 座標）を使い、
  // "スクリーン高さ - キーボード高さ - ScrollView 上端" でキーボード上の実表示高さを正確に算出する。
  // svH - kh だけでは ScrollView の画面上位置を考慮しないため過小推計になる場合がある。
  function scrollToBlockEnd(blockIdx: number, kh: number) {
    if (!scrollRef?.current) return;
    const base = scrollBaseYRef?.current ?? 0;
    const blockY = base + containerYRef.current + (blockYPositions.current[blockIdx] ?? 0);
    const blockH = blockHeights.current[blockIdx] ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scrollRef.current as any).measure?.((
      _x: number, _y: number, _w: number, svH: number, _pageX: number, pageY: number
    ) => {
      const screenH = Dimensions.get('window').height;
      const visibleH = Math.max(80, Math.min(svH, screenH - kh - pageY));
      scrollRef.current?.scrollTo({
        y: Math.max(0, blockY + blockH - visibleH + 16),
        animated: true,
      });
    });
  }

  function handleEditRequest(blockIdx: number) {
    const prev = editingBlockIdxRef.current;
    if (prev !== null && prev !== blockIdx) {
      setExitEditTriggers(t => ({ ...t, [prev]: (t[prev] ?? 0) + 1 }));
    }
    editingBlockIdxRef.current = blockIdx;
    setEditingBlockIdx(blockIdx);
    onSelectCodeBlock?.(codeBlockIndexMap[blockIdx]);

    // FlipCard の 3D トランスフォームにより iOS の自動スクロールが機能しないため
    // レンダリング完了後（400ms）に手動スクロール。
    if (scrollRef?.current) {
      setTimeout(() => scrollToBlockEnd(blockIdx, kbHeightRef.current), 400);
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
      scrollToBlockEnd(blockIdx, kh);
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

  const markdownStyles = useMemo(() => ({
    body: { fontSize: theme.fontSize.lg, color: theme.colors.text, lineHeight: theme.fontSize.lg * 1.5 },
    heading1: { fontSize: theme.fontSize.xxl, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 8 },
    heading2: { fontSize: theme.fontSize.xl, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 6 },
    heading3: { fontSize: theme.fontSize.lg, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 4 },
    heading4: { fontSize: theme.fontSize.md, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 4 },
    heading5: { fontSize: theme.fontSize.sm, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 4 },
    heading6: { fontSize: theme.fontSize.xs, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 4 },
    strong: { fontWeight: 'bold' as const },
    em: { fontStyle: 'italic' as const },
    code_inline: {
      backgroundColor: theme.dark ? '#2C2C2C' : '#F0F0F0',
      fontFamily: 'monospace',
      fontSize: theme.fontSize.md,
      color: theme.colors.danger,
    },
    fence: { backgroundColor: theme.cardTheme.codeBackground, borderRadius: 6, padding: 12, color: '#FFFFFF', fontFamily: 'monospace', fontSize: theme.fontSize.md },
    code_block: { fontFamily: 'monospace', fontSize: theme.fontSize.md, color: '#FFFFFF', backgroundColor: theme.cardTheme.codeBackground },
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
    // リンクはインラインの Text として描画する（Pressable=View だとテキストの流れを崩して
    // 表示がズレるため）。本文と同じフォントサイズで青字下線にし、長押しで開く。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    link: (node: any, children: any) => (
      <Text
        key={node.key}
        style={{ color: '#3B82F6', textDecorationLine: 'underline', fontSize: theme.fontSize.lg }}
        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
        onLongPress={() => { suppress(); Linking.openURL(node.attributes.href); }}
      >
        {children}
      </Text>
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    image: (node: any) => (
      <Image
        key={node.key}
        source={{ uri: node.attributes.src }}
        style={{ width: '100%', height: 200 }}
        contentFit="contain"
        accessibilityLabel={node.attributes.alt}
      />
    ),
    // ハイライト（==文字==）。背景色のみ指定し文字色は親から継承させる。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mark: (node: any, children: any) => (
      <Text key={node.key} style={{ backgroundColor: HIGHLIGHT_COLORS[theme.dark ? 'dark' : 'light'] }}>{children}</Text>
    ),
  }), [suppress, theme.fontSize.lg, theme.dark]);

  if (blocks.length === 0) {
    return <Text style={[styles.empty, { color: theme.colors.iconSubtle, fontSize: theme.fontSize.sm }]}>{t('card.noContent')}</Text>;
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
          const textContent = (block as TextBlock).content;
          return (
            <View key={i} style={styles.textBlock}>
              <Markdown markdownit={mdInstance} style={markdownStyles} onLinkPress={() => false} rules={linkRule}>{textContent}</Markdown>
              {textContent.trim() ? <TextBlockCopyBtn content={textContent} suppress={suppress} /> : null}
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
                deckSqlInit={deckSqlInit}
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
                <Text style={[styles.imagePlaceholderText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.xxl }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>🖼</Text>
              </View>
            )}
            {!!imgBlock.alt && (
              <Text style={[styles.altText, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}>{imgBlock.alt}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  empty: { fontStyle: 'italic', textAlign: 'center' },
  textBlock: { position: 'relative' },
  textCopyBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 4,
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderRadius: 4,
  },
  imageBlock: { gap: 6 },
  altText: { textAlign: 'center', fontStyle: 'italic' },
  imagePlaceholder: {
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
  },
  imagePlaceholderText: {},
});
