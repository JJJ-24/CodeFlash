import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';

import { tokenize, type TokenType } from '@/lib/syntax-highlight';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

// Material Design 系の鮮やかパレット。彩度の高いカードテーマ背景上でも
// 「フィルター越し」感が出ないよう、VSCode Dark+ より各色を強めに振っている。
// number は黄色系にして comment（緑）と意味的に区別。
const TOKEN_COLORS: Record<TokenType, string> = {
  keyword:     '#4FC3F7',  // 鮮やかな空色（より青い）
  string:      '#FFB74D',  // 鮮やかな琥珀（salmon → vivid amber）
  comment:     '#7CB342',  // やや明るい緑（控えめだが鮮やか）
  number:      '#FFCA28',  // 鮮やかな黄色（comment と判別しやすく）
  type:        '#26C6DA',  // 鮮やかなシアン
  punctuation: '#FFFFFF',
  plain:       '#FFFFFF',
};

interface Props {
  code: string;
  language: string;
}

export function SyntaxHighlightedCode({ code, language }: Props) {
  const theme = useTheme();
  const tokens = useMemo(() => tokenize(code.replace(/[\u2028\u2029]/g, '\n'), language), [code, language]);

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
