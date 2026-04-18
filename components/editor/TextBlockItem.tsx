import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { useTranslation } from 'react-i18next';

import { BlockItemHeader } from './BlockItemHeader';

const markdownItLinkify = MarkdownIt({ linkify: true });
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
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
  isLast?: boolean;
  onCollapsedDoubleTap?: () => void;
  onFocusInput?: () => void;
  /** キーボードナビゲーションでこのブロックが選択されているか */
  isFocused?: boolean;
  /** BlockEditor から編集開始を指示するトリガー（値が変化するたびにフォーカス） */
  editTrigger?: number;
  /** TextInput のフォーカスが外れたとき BlockEditor に通知するコールバック */
  onEditBlur?: () => void;
}

export function TextBlockItem({ block, isPreview, onChange, onDelete, autoFocus, onMoveUp, onMoveDown, collapsed, flashTrigger = 0, isLast, onCollapsedDoubleTap, onFocusInput, isFocused, editTrigger, onEditBlur }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
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
    if (autoFocus) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, []);

  useEffect(() => {
    if ((editTrigger ?? 0) > 0) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [editTrigger]);

  useEffect(() => {
    if (prevCollapsedRef.current === true && collapsed === false) {
      setFocused(false);
      if (pendingFocusRef.current) {
        pendingFocusRef.current = false;
        setTimeout(() => inputRef.current?.focus(), 80);
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

  const markdownStyles = useMemo(() => ({
    body: { fontSize: theme.fontSize.md, color: theme.colors.text, lineHeight: theme.fontSize.md * 1.5 },
    heading1: { fontSize: theme.fontSize.xl, fontWeight: '700' as const, color: theme.colors.text },
    heading2: { fontSize: theme.fontSize.lg, fontWeight: '700' as const, color: theme.colors.text },
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme]);

  const linkRule = useMemo(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    link: (node: any, children: any) => (
      <Pressable
        key={node.key}
        onPress={() => Linking.openURL(node.attributes.href)}
        style={({ pressed }) => pressed ? { backgroundColor: 'rgba(59,130,246,0.15)', borderRadius: 3 } : undefined}
      >
        <Text style={{ color: '#3B82F6', textDecorationLine: 'underline' }}>{children}</Text>
      </Pressable>
    ),
  }), []);

  return (
    <View style={[
      styles.container,
      { backgroundColor: theme.colors.surface, borderColor: flashTrigger > 0 ? theme.colors.primary : ((focused || isFocused) ? theme.colors.primary : theme.colors.inputBorder) },
    ]}>
      <BlockItemHeader
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDelete={onDelete}
        collapsed={collapsed}
        isEmpty={isEmpty}
        isLast={isLast}
        style={{
          backgroundColor: theme.dark ? '#252525' : '#FAFAFA',
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Text style={[styles.typeLabel, { color: theme.colors.textTertiary }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>T</Text>
      </BlockItemHeader>

      {collapsed ? (
        <Pressable onPress={handleCollapsedPress}>
          <Text
            style={[styles.collapsedPreview, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}
            numberOfLines={2}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
          >
            {block.content || t('card.emptyTextBlock')}
          </Text>
        </Pressable>
      ) : isPreview ? (
        <View style={styles.preview}>
          {block.content.trim() ? (
            <Markdown markdownit={markdownItLinkify} style={markdownStyles} rules={linkRule}>{block.content}</Markdown>
          ) : (
            <Text style={[styles.placeholder, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{t('card.emptyTextBlock')}</Text>
          )}
        </View>
      ) : (
        // 水平 ScrollView でラップすることで、iOS の「scroll to first responder」を
        // 水平方向で吸収し、外側の縦 ScrollView への自動スクロールを防ぐ。
        // （CodeBlockItem と同じ機構）
        <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} bounces={false}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: theme.colors.text, fontSize: theme.fontSize.md, width: width - 32 }]}
            value={block.content}
            onChangeText={onChange}
            multiline
            scrollEnabled={false}
            placeholder={t('card.textBlockPlaceholder')}
            placeholderTextColor={theme.colors.textTertiary}
            onFocus={() => { setFocused(true); onFocusInput?.(); }}
            onBlur={() => { setFocused(false); onEditBlur?.(); }}
            textAlignVertical="top"
            autoCorrect={false}
            spellCheck={false}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
          />
        </ScrollView>
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
  typeLabel: { fontWeight: '700', fontSize: 18 },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 80,
    lineHeight: 22,
  },
  preview: { paddingHorizontal: 14, paddingVertical: 12 },
  placeholder: { fontStyle: 'italic' },
  collapsedPreview: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    lineHeight: 20,
  },
});
