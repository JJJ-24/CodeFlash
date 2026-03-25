import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { useTranslation } from 'react-i18next';

import { BlockItemHeader } from './BlockItemHeader';

const markdownItLinkify = MarkdownIt({ linkify: true });
import { useTheme } from '@/lib/theme';
import type { TextBlock } from '@/types';

interface Props {
  block: TextBlock;
  isPreview: boolean;
  onChange: (content: string) => void;
  onDelete: () => void;
  autoFocus?: boolean;
  onDragStart?: () => void;
  collapsed?: boolean;
  isLast?: boolean;
  onCollapsedDoubleTap?: () => void;
}

export function TextBlockItem({ block, isPreview, onChange, onDelete, autoFocus, onDragStart, collapsed, isLast, onCollapsedDoubleTap }: Props) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const doubleTapCountRef = useRef(0);
  const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocusRef = useRef(false);
  const prevCollapsedRef = useRef(collapsed);
  const theme = useTheme();
  const isEmpty = block.content.trim() === '';

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, []);

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

  return (
    <View style={[
      styles.container,
      { backgroundColor: theme.colors.surface, borderColor: focused ? theme.colors.primary : theme.colors.inputBorder },
    ]}>
      <BlockItemHeader
        onDragStart={onDragStart}
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
        <Text style={[styles.typeLabel, { color: theme.colors.textTertiary, fontSize: theme.fontSize.lg }]}>T</Text>
      </BlockItemHeader>

      {collapsed ? (
        <Pressable onPress={handleCollapsedPress}>
          <Text
            style={[styles.collapsedPreview, { color: theme.colors.textTertiary, fontSize: theme.fontSize.sm }]}
            numberOfLines={2}
          >
            {block.content || t('card.emptyTextBlock')}
          </Text>
        </Pressable>
      ) : isPreview ? (
        <View style={styles.preview}>
          {block.content.trim() ? (
            <Markdown markdownit={markdownItLinkify} style={markdownStyles}>{block.content}</Markdown>
          ) : (
            <Text style={[styles.placeholder, { color: theme.colors.textTertiary, fontSize: theme.fontSize.md }]}>{t('card.emptyTextBlock')}</Text>
          )}
        </View>
      ) : (
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
          value={block.content}
          onChangeText={onChange}
          multiline
          scrollEnabled={false}
          placeholder={t('card.textBlockPlaceholder')}
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
  typeLabel: { fontWeight: '700' },
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
