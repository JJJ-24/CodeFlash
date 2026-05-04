import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';

import { tokenize, type TokenType } from '@/lib/syntax-highlight';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

const TOKEN_COLORS: Record<TokenType, string> = {
  keyword:     '#569CD6',
  string:      '#CE9178',
  comment:     '#6A9955',
  number:      '#B5CEA8',
  type:        '#4EC9B0',
  punctuation: '#D4D4D4',
  plain:       '#D4D4D4',
};

interface Props {
  code: string;
  language: string;
}

export function SyntaxHighlightedCode({ code, language }: Props) {
  const theme = useTheme();
  const tokens = useMemo(() => tokenize(code, language), [code, language]);

  return (
    <Text style={[styles.base, { fontSize: theme.fontSize.lg, lineHeight: theme.fontSize.lg * 1.5 }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
      {tokens.map((token, idx) => (
        <Text key={idx} style={{ color: TOKEN_COLORS[token.type] }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {token.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: 'monospace',
    lineHeight: 22,
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexWrap: 'wrap',
  },
});
