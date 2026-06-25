import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';

import markdownItMark from 'markdown-it-mark';

import { BlockItemHeader } from './BlockItemHeader';
import { MD_TOOLBAR_ID } from './MarkdownToolbar';

// linkify: 生URL を自動リンク化 / markdownItMark: ==文字== をハイライト（<mark>）化
const markdownItLinkify = MarkdownIt({ linkify: true }).use(markdownItMark);
import { useTheme, MAX_FONT_MULTIPLIER, HIGHLIGHT_COLORS } from '@/lib/theme';
import { wrapSelection, type Sel } from '@/lib/editor/applyMarkdown';
import type { TextBlock } from '@/types';

interface Props {
  block: TextBlock;
  isPreview: boolean;
  onChange: (content: string) => void;
  onDelete: () => void;
  autoFocus?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  collapsed?: boolean;
  flashTrigger?: number;
  onCollapsedDoubleTap?: () => void;
  onFocusInput?: () => void;
  /** キーボードナビゲーションでこのブロックが選択されているか */
  isFocused?: boolean;
  /** BlockEditor から編集開始を指示するトリガー（値が変化するたびにフォーカス） */
  editTrigger?: number;
  /** BlockEditor からフォーカス解除を指示するトリガー（値が変化するたびにブラー） */
  blurTrigger?: number;
  /** TextInput のフォーカスが外れたとき BlockEditor に通知するコールバック */
  onEditBlur?: () => void;
  /** マウント時の autoFocus が実行されたとき BlockEditor に通知するコールバック */
  onAutoFocused?: () => void;
  /** フォーカス時、共有ツールバーへ「このブロックに記法を適用する関数」を登録する */
  onActivateToolbar?: (apply: (left: string, right: string) => void) => void;
  /** ブラー時、共有ツールバーから登録を解除する（同じ関数のときのみ解除） */
  onDeactivateToolbar?: (apply: (left: string, right: string) => void) => void;
}

export function TextBlockItem({ block, isPreview, onChange, onDelete, autoFocus, onMoveUp, onMoveDown, collapsed, flashTrigger = 0, onCollapsedDoubleTap, onFocusInput, isFocused, editTrigger, blurTrigger, onEditBlur, onAutoFocused, onActivateToolbar, onDeactivateToolbar }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await Clipboard.setStringAsync(block.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }
  const inputRef = useRef<TextInput>(null);

  // 装飾ツールバー用: 選択範囲を ref で追跡し、記法適用後はカーソルを内側へ移す。
  const selectionRef = useRef<Sel>({ start: 0, end: 0 });
  const [pendingSelection, setPendingSelection] = useState<Sel | undefined>(undefined);

  const handleSelectionChange = useCallback((e: { nativeEvent: { selection: Sel } }) => {
    selectionRef.current = e.nativeEvent.selection;
    // プログラムでカーソルを移した直後の onSelectionChange で制御を解放（以後は非制御に戻す）
    setPendingSelection((prev) => (prev ? undefined : prev));
  }, []);

  const handleWrap = useCallback((left: string, right: string) => {
    const result = wrapSelection(block.content, selectionRef.current, left, right);
    onChange(result.text);
    selectionRef.current = result.selection;
    setPendingSelection(result.selection);
  }, [block.content, onChange]);

  // フォーカス中は共有ツールバーへ自分の適用関数を登録（content 変化で最新へ差し替え）。
  // ブラー・アンマウント時は登録解除。InputAccessoryView 自体は BlockEditor に1つ常設。
  useEffect(() => {
    if (!focused) return;
    onActivateToolbar?.(handleWrap);
    return () => onDeactivateToolbar?.(handleWrap);
  }, [focused, handleWrap, onActivateToolbar, onDeactivateToolbar]);

  const enterEditMode = useCallback(() => {
    setFocused(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const tapGesture = useMemo(
    () => Gesture.Tap().maxDeltaX(8).maxDeltaY(8).onEnd(() => { runOnJS(enterEditMode)(); }),
    [enterEditMode],
  );

  const doubleTapCountRef = useRef(0);
  const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocusRef = useRef(false);
  const prevCollapsedRef = useRef(collapsed);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const theme = useTheme();
  const isEmpty = block.content.trim() === '';

  useEffect(() => {
    if (flashTrigger > 0) {
      flashAnim.setValue(1);
      Animated.timing(flashAnim, { toValue: 0, duration: 600, useNativeDriver: true }).start();
    }
  }, [flashTrigger]);

  useEffect(() => {
    if (autoFocus) { setFocused(true); setTimeout(() => inputRef.current?.focus(), 50); onAutoFocused?.(); }
  }, []);

  useEffect(() => {
    if ((editTrigger ?? 0) > 0) { setFocused(true); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [editTrigger]);

  useEffect(() => {
    if ((blurTrigger ?? 0) > 0) { inputRef.current?.blur(); }
  }, [blurTrigger]);

  useEffect(() => {
    if (isPreview) {
      setFocused(false);
      inputRef.current?.blur();
    }
  }, [isPreview]);

  useEffect(() => {
    if (collapsed) {
      setFocused(false);
      inputRef.current?.blur();
    } else if (prevCollapsedRef.current === true) {
      setFocused(false);
      if (pendingFocusRef.current) {
        pendingFocusRef.current = false;
        setFocused(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }
    prevCollapsedRef.current = collapsed;
  }, [collapsed]);

  function handleCollapsedPress() {
    doubleTapCountRef.current += 1;
    if (doubleTapCountRef.current === 1) {
      doubleTapTimerRef.current = setTimeout(() => {
        doubleTapCountRef.current = 0;
      }, 300);
    } else if (doubleTapCountRef.current >= 2) {
      if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
      doubleTapCountRef.current = 0;
      pendingFocusRef.current = true;
      onCollapsedDoubleTap?.();
    }
  }

  const markdownStyles = useMemo(() => {
    if (isPreview) {
      // 学習画面（BlocksView）と同じスタイル
      return {
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
        fence: { backgroundColor: '#1E1E1E', borderRadius: 6, padding: 12, color: '#D4D4D4', fontFamily: 'monospace', fontSize: theme.fontSize.md },
        code_block: { fontFamily: 'monospace', fontSize: theme.fontSize.md, color: '#D4D4D4', backgroundColor: '#1E1E1E' },
        link: { color: '#3B82F6', textDecorationLine: 'underline' as const },
        blockquote: {
          backgroundColor: theme.dark ? '#2A2A2A' : '#F0F0F0',
          borderLeftWidth: 4,
          borderLeftColor: theme.colors.textSecondary,
          paddingHorizontal: 12,
          paddingVertical: 4,
          marginVertical: 4,
        },
      };
    }
    return {
      body: { fontSize: theme.fontSize.md, color: theme.colors.text, lineHeight: theme.fontSize.md * 1.5 },
      heading1: { fontSize: theme.fontSize.xl, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 0 },
      heading2: { fontSize: theme.fontSize.lg, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 0 },
      heading3: { fontSize: theme.fontSize.md, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 0 },
      heading4: { fontSize: theme.fontSize.md, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 0 },
      heading5: { fontSize: theme.fontSize.sm, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 0 },
      heading6: { fontSize: theme.fontSize.xs, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 0 },
      strong: { fontWeight: 'bold' as const },
      em: { fontStyle: 'italic' as const },
      code_inline: {
        backgroundColor: theme.dark ? '#2C2C2C' : '#F0F0F0',
        fontFamily: 'monospace',
        fontSize: theme.fontSize.sm,
        color: theme.colors.danger,
      },
      fence: { backgroundColor: '#1E1E1E', borderRadius: 6, padding: 12, color: '#D4D4D4', fontFamily: 'monospace', fontSize: theme.fontSize.sm },
      code_block: { fontFamily: 'monospace', fontSize: theme.fontSize.sm, color: '#D4D4D4', backgroundColor: '#1E1E1E' },
      link: { color: '#3B82F6', textDecorationLine: 'underline' as const },
      blockquote: {
        backgroundColor: theme.dark ? '#2A2A2A' : '#F0F0F0',
        borderLeftWidth: 4,
        borderLeftColor: theme.colors.textSecondary,
        paddingHorizontal: 12,
        paddingVertical: 4,
        marginVertical: 4,
      },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, isPreview]);

  const highlightBg = HIGHLIGHT_COLORS[theme.dark ? 'dark' : 'light'];
  const linkRule = useMemo(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    link: (node: any, children: any) => (
      <Pressable
        key={node.key}
        onPress={() => Linking.openURL(node.attributes.href)}
        style={({ pressed }) => pressed ? { backgroundColor: 'rgba(59,130,246,0.15)', borderRadius: 3 } : undefined}
      >
        <Text style={{ color: '#3B82F6', textDecorationLine: 'underline' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{children}</Text>
      </Pressable>
    ),
    // ハイライト（==文字==）。背景色のみ指定し文字色は親から継承させる。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mark: (node: any, children: any) => (
      <Text key={node.key} style={{ backgroundColor: highlightBg }}>{children}</Text>
    ),
  }), [highlightBg]);

  return (
    <View style={[
      styles.container,
      isPreview
        ? { backgroundColor: 'transparent', borderWidth: 0 }
        : { backgroundColor: theme.colors.surface, borderColor: flashTrigger > 0 ? theme.colors.primary : focused ? '#FB8C00' : isFocused ? theme.colors.primary : theme.colors.inputBorder, borderWidth: (focused || isFocused) ? 2 : 1 },
    ]}>
      {!isPreview && (
        <BlockItemHeader
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onDelete={onDelete}
          collapsed={collapsed}
          isEmpty={isEmpty}
          onHeaderPress={focused ? () => { inputRef.current?.blur(); } : undefined}
          hideDelete={isPreview}
          style={{
            backgroundColor: focused ? '#4A3400' : isFocused ? '#1A3050' : (theme.dark ? '#252525' : '#FAFAFA'),
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={[styles.typeLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>T</Text>
        </BlockItemHeader>
      )}

      {collapsed ? (
        <Pressable onPress={handleCollapsedPress}>
          <Text
            style={[styles.collapsedPreview, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}
            numberOfLines={2}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
          >
            {block.content || t('editor.emptyTextBlock')}
          </Text>
        </Pressable>
      ) : isPreview ? (
        <View style={[styles.preview, isPreview && { paddingHorizontal: 0, paddingVertical: 0 }]}>
          <Markdown markdownit={markdownItLinkify} style={markdownStyles} rules={linkRule}>{block.content}</Markdown>
          {block.content.trim() ? (
            <Pressable style={styles.copyBtn} onPress={handleCopy} hitSlop={8}>
              <Ionicons name={copied ? 'checkmark-sharp' : 'copy-outline'} size={theme.fontSize.sm} color="#4B5563" />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.inputArea}>
          {focused ? (
            <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} style={{ width: width - 32 }}>
              <TextInput
                ref={inputRef}
                style={[styles.input, { color: theme.colors.text, fontSize: theme.fontSize.md, width: width - 32 }]}
                value={block.content}
                onChangeText={onChange}
                selection={pendingSelection}
                onSelectionChange={handleSelectionChange}
                inputAccessoryViewID={Platform.OS === 'ios' ? MD_TOOLBAR_ID : undefined}
                multiline
                scrollEnabled={false}
                placeholder={t('editor.textBlockPlaceholder')}
                placeholderTextColor={theme.colors.textTertiary}
                onFocus={() => {
                  setFocused(true);
                  onFocusInput?.();
                  // プログラム的フォーカス時 iOS はカーソルを末尾に置くが、その位置の
                  // onSelectionChange が発火しないことがあるため selectionRef を末尾で初期化。
                  const len = block.content.length;
                  selectionRef.current = { start: len, end: len };
                }}
                onBlur={() => { setFocused(false); onEditBlur?.(); }}
                textAlignVertical="top"
                autoCorrect={false}
                spellCheck={false}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              />
            </ScrollView>
          ) : (
            <GestureDetector gesture={tapGesture}>
              <Text
                style={[styles.input, { color: block.content ? theme.colors.text : theme.colors.textTertiary, fontSize: theme.fontSize.md, fontStyle: block.content ? 'normal' : 'italic' }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {block.content || t('editor.textBlockPlaceholder')}
              </Text>
            </GestureDetector>
          )}
          {block.content.trim() ? (
            <Pressable style={styles.copyBtn} onPress={handleCopy} hitSlop={8}>
              <Ionicons name={copied ? 'checkmark-sharp' : 'copy-outline'} size={theme.fontSize.sm} color="#4B5563" />
            </Pressable>
          ) : null}
        </View>
      )}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: flashAnim, backgroundColor: theme.colors.primaryLight, borderRadius: 10 }]}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  typeLabel: { fontWeight: '700' },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 80,
    lineHeight: 22,
  },
  preview: { paddingHorizontal: 14, paddingVertical: 12, position: 'relative' },
  inputArea: { position: 'relative' },
  copyBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 4,
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderRadius: 4,
  },
  collapsedPreview: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    lineHeight: 20,
  },
});
